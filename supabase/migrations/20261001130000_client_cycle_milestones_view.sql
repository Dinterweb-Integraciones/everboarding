-- Semáforo de hitos del ciclo por cliente. Incluye clientes activos y, como en Operaciones,
-- los inactivos que aún tengan créditos disponibles o comprometidos. Los días se cuentan desde el inicio del
-- ciclo vigente del cliente (día 1 = inicio del ciclo):
--   Hito 1: día 15 o más y créditos disponibles < 10% de los créditos contratados.
--   Hito 2: día 20 o más y créditos comprometidos (Planificado + En ejecución) < 20% de los contratados.
--   Hito 3: día 25 o más y créditos En Evaluación (casos creados en el ciclo) >= 50% del caudal.
-- Un hito solo se cumple con ambas condiciones; antes de su día cuenta como no cumplido.
-- Color: verde = 3 hitos, amarillo = 2, rojo = 1 o ninguno.
-- Ciclo, contratados, caudal y disponibles siguen la misma lógica del informe de Operaciones.
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
credits as (
  select
    b.*,
    (current_date - b.cycle_start_date + 1)::integer as cycle_day,
    case
      when b.billing = 'paquetes' then coalesce(b.granted_total, 0)
      -- Con ciclos pagados por adelantado se toma el plan completo contratado.
      when b.has_future_grant then b.plan_credits
      else round(b.plan_credits::numeric / b.period_months)
    end::numeric as contracted_credits,
    greatest(coalesce(b.active_credits, 0) + b.extra_capacity - b.lost_credits, 0)::numeric as available_credits,
    coalesce((
      select sum(i.credits)
      from initiative_credits i
      where i.client_id = b.client_id
        and i.status in ('planned', 'executing')
    ), 0) as committed_credits,
    coalesce((
      select sum(i.credits)
      from initiative_credits i
      where i.client_id = b.client_id
        and i.status = 'backlog'
        and (i.created_at at time zone 'utc')::date >= b.cycle_start_date
    ), 0) as evaluation_credits
  from base b
),
flow as (
  select
    c.*,
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
milestones as (
  select
    p.*,
    coalesce(p.cycle_day >= 15 and p.available_pct < 10, false) as milestone_available,
    coalesce(p.cycle_day >= 20 and p.committed_pct < 20, false) as milestone_committed,
    coalesce(p.cycle_day >= 25 and p.evaluation_pct >= 50, false) as milestone_evaluation
  from percentages p
),
scored as (
  select
    m.*,
    (
      m.milestone_available::integer
      + m.milestone_committed::integer
      + m.milestone_evaluation::integer
    ) as milestones_met
  from milestones m
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
  milestone_available,
  milestone_committed,
  milestone_evaluation,
  milestones_met,
  case
    when milestones_met = 3 then 'verde'
    when milestones_met = 2 then 'amarillo'
    else 'rojo'
  end as color
from scored
-- Un cliente inactivo sigue en el reporte mientras tenga créditos disponibles o comprometidos.
where is_active
   or available_credits > 0
   or committed_credits > 0;
