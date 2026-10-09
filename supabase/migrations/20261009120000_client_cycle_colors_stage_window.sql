-- Semáforo del ciclo alineado con el informe de Operaciones: Disponibles y Comprometidos solo
-- cuentan créditos que pasaron a esa etapa dentro de la ventana del cliente — su ciclo vigente si
-- es recurrente, o los últimos 30 días si es de paquetes.
--   Disponibles: saldo vigente de los grants otorgados en la ventana, sin superar el saldo real.
--   Comprometidos: casos Planificados / En ejecución que entraron a esa etapa en la ventana
--     (último registro "Cambio a ..." de la bitácora; sin registro, la fecha de creación).
--   En Evaluación es la excepción: cuenta todo lo que hoy está en evaluación, sin ventana.
-- La visibilidad de clientes inactivos sigue usando el saldo real y todo lo comprometido.
drop view if exists public.client_cycle_milestones_report;

create view public.client_cycle_milestones_report
with (security_invoker = true)
as
with current_cycle as (
  -- Ciclo pagado vigente: el de fin más reciente entre los que ya empezaron.
  select distinct on (b.client_id)
    b.client_id,
    b.cycle_start_date,
    b.cycle_end_date
  from public.client_billing_cycles b
  where b.status = 'paid'
    and b.cycle_start_date <= current_date
  order by b.client_id, b.cycle_end_date desc
),
current_grant as (
  -- Grant del ciclo vigente: el más reciente que ya empezó.
  select distinct on (g.client_id)
    g.client_id,
    g.grant_date,
    g.granted_credits
  from public.client_credit_grants g
  where g.grant_date <= current_date
  order by g.client_id, g.grant_date desc, g.created_at desc
),
grant_rollup as (
  select
    g.client_id,
    coalesce(sum(g.granted_credits), 0)::integer as granted_total,
    coalesce(
      sum(greatest(g.granted_credits - g.used_credits - g.expired_credits, 0))
        filter (where g.expires_at >= current_date and g.grant_date <= current_date),
      0
    )::integer as active_credits,
    bool_or(g.grant_date > current_date) as has_future_grant
  from public.client_credit_grants g
  group by g.client_id
),
initiative_credits as (
  select
    i.id,
    i.client_id,
    i.status,
    i.created_at,
    -- Fecha en que el caso entró a su etapa actual (Planificado / En ejecución).
    coalesce(
      (
        select max(l.created_at)
        from public.onboarding_activity_logs l
        where l.initiative_id = i.id
          and lower(l.entry) like case i.status
            when 'planned' then '%cambio a planificado%'
            when 'executing' then '%cambio a en ejecuci_n%'
          end
      ),
      i.created_at
    ) as stage_entered_at,
    coalesce(sum(s.unit_credits * s.quantity), 0)::numeric as credits
  from public.onboarding_initiatives i
  left join public.onboarding_initiative_subitems s
    on s.initiative_id = i.id
  group by i.id
),
base as (
  select
    c.id as client_id,
    c.name as client_name,
    c.csm_user_id as customer_success_id,
    csm.full_name as customer_success_name,
    c.is_active,
    case
      when coalesce(config.custom_plan_billing_mode::text, 'subscription') = 'one_time' then 'paquetes'
      else 'recurrencia'
    end as billing,
    coalesce(cc.cycle_start_date, cg.grant_date, current_date - 30) as cycle_start_date,
    cc.cycle_end_date,
    coalesce(gr.has_future_grant, false) as has_future_grant,
    cg.granted_credits as current_grant_credits,
    gr.granted_total,
    gr.active_credits,
    config.flow_credits,
    coalesce(config.extra_capacity, 0) as extra_capacity,
    coalesce(config.lost_credits, 0) as lost_credits,
    greatest(coalesce(config.custom_plan_period_months, 1), 1) as period_months,
    coalesce(
      config.custom_plan_credits,
      coalesce(config.base_capacity, 0) * coalesce(config.custom_plan_period_months, 1)
    ) as plan_credits
  from public.clients c
  left join public.profiles csm
    on csm.id = c.csm_user_id
  left join public.onboarding_configs config
    on config.client_id = c.id
  left join current_cycle cc
    on cc.client_id = c.id
  left join current_grant cg
    on cg.client_id = c.id
  left join grant_rollup gr
    on gr.client_id = c.id
),
windowed as (
  -- Ventana de las etapas: últimos 30 días para paquetes, ciclo vigente para recurrentes.
  select
    b.*,
    case when b.billing = 'paquetes' then current_date - 30 else b.cycle_start_date end as window_start,
    case when b.billing = 'paquetes' then null else b.cycle_end_date end as window_end
  from base b
),
credits as (
  select
    w.*,
    (current_date - w.cycle_start_date + 1)::integer as cycle_day,
    case
      when w.billing = 'paquetes' then coalesce(w.granted_total, 0)
      -- Con ciclos pagados por adelantado se toma el plan completo contratado.
      when w.has_future_grant then w.plan_credits
      else round(w.plan_credits::numeric / w.period_months)
    end::numeric as contracted_credits,
    greatest(coalesce(w.active_credits, 0) + w.extra_capacity - w.lost_credits, 0)::numeric as balance_credits,
    coalesce((
      select sum(greatest(g.granted_credits - g.used_credits - g.expired_credits, 0))
      from public.client_credit_grants g
      where g.client_id = w.client_id
        and g.expires_at >= current_date
        and g.grant_date <= current_date
        and g.grant_date >= w.window_start
        and (w.window_end is null or g.grant_date <= w.window_end)
    ), 0)::numeric as window_granted_remaining,
    coalesce((
      select sum(i.credits)
      from initiative_credits i
      where i.client_id = w.client_id
        and i.status in ('planned', 'executing')
    ), 0) as all_committed_credits,
    coalesce((
      select sum(i.credits)
      from initiative_credits i
      where i.client_id = w.client_id
        and i.status in ('planned', 'executing')
        and (i.stage_entered_at at time zone 'utc')::date >= w.window_start
        and (w.window_end is null or (i.stage_entered_at at time zone 'utc')::date <= w.window_end)
    ), 0) as committed_credits,
    coalesce((
      select sum(i.credits)
      from initiative_credits i
      where i.client_id = w.client_id
        and i.status = 'backlog'
    ), 0) as evaluation_credits
  from windowed w
),
flow as (
  select
    c.*,
    least(c.window_granted_remaining, c.balance_credits) as available_credits,
    -- Caudal del cliente; sin caudal definido, el grant del ciclo vigente si hay ciclos
    -- pagados por adelantado, o los créditos contratados del ciclo.
    coalesce(
      c.flow_credits,
      case when c.has_future_grant and c.current_grant_credits is not null then c.current_grant_credits end,
      c.contracted_credits
    )::numeric as flow_credits_effective
  from credits c
),
percentages as (
  select
    f.*,
    round(100 * f.available_credits / nullif(f.contracted_credits, 0), 1) as available_pct,
    round(100 * f.committed_credits / nullif(f.contracted_credits, 0), 1) as committed_pct,
    round(100 * f.evaluation_credits / nullif(f.flow_credits_effective, 0), 1) as evaluation_pct
  from flow f
),
colored as (
  select
    p.*,
    case
      when p.cycle_day < 15 or p.available_pct is null then 'gris'
      when p.available_pct < 10 then 'verde'
      when p.available_pct < 20 then 'naranja'
      else 'rojo'
    end as available_color,
    case
      when p.cycle_day < 20 or p.committed_pct is null then 'gris'
      when p.committed_pct < 20 then 'verde'
      when p.committed_pct < 30 then 'naranja'
      else 'rojo'
    end as committed_color,
    case
      when p.cycle_day < 25 or p.evaluation_pct is null then 'gris'
      when p.evaluation_pct >= 50 then 'verde'
      when p.evaluation_pct >= 40 then 'naranja'
      else 'rojo'
    end as evaluation_color
  from percentages p
)
select
  client_id,
  client_name,
  customer_success_id,
  customer_success_name,
  is_active,
  billing,
  cycle_start_date,
  cycle_end_date,
  cycle_day,
  contracted_credits,
  flow_credits_effective as flow_credits,
  available_credits,
  available_pct,
  committed_credits,
  committed_pct,
  evaluation_credits,
  evaluation_pct,
  available_color,
  committed_color,
  evaluation_color
from colored
-- Un cliente inactivo sigue en el reporte mientras tenga créditos disponibles o comprometidos.
where is_active
   or balance_credits > 0
   or all_committed_credits > 0;
