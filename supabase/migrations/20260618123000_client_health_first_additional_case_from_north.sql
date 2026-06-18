drop view if exists public.client_health_report;

create or replace view public.client_health_report
with (security_invoker = true)
as
with fundamental_groups as (
  select distinct groups.id, groups.name
  from public.credit_catalog_groups groups
  left join public.credit_catalog_group_category_links links
    on links.group_id = groups.id
  left join public.credit_catalog_group_categories categories
    on categories.id = links.category_id
  where lower(trim(coalesce(groups.modal_category, ''))) in ('fundamentos', 'fundamentales')
     or lower(trim(coalesce(categories.name, ''))) in ('fundamentos', 'fundamentales')
),
initiative_credits as (
  select
    i.id,
    i.client_id,
    i.status,
    i.type,
    i.title,
    i.labels,
    i.created_at,
    i.updated_at,
    exists (
      select 1
      from fundamental_groups groups
      where lower(trim(groups.name)) in (lower(trim(coalesce(i.type, ''))), lower(trim(i.title)))
    ) as is_fundamental,
    coalesce(sum(s.unit_credits * s.quantity), 0)::integer as credits
  from public.onboarding_initiatives i
  left join public.onboarding_initiative_subitems s
    on s.initiative_id = i.id
  group by i.id
),
client_rollup as (
  select
    c.id as client_id,
    c.name as client_name,
    c.slug as client_slug,
    c.csm_user_id as customer_success_id,
    csm.full_name as customer_success_name,
    csm.email as customer_success_email,
    coalesce(config.start_date, c.created_at::date) as start_date,
    config.north_star_completed_at::date as north_star_completed_date,
    coalesce(config.custom_plan_billing_mode::text, 'subscription') as billing_mode,
    count(i.id)::integer as total_cases,
    count(i.id) filter (where i.status = 'completed')::integer as completed_cases,
    count(i.id) filter (where i.status = 'completed' and not i.is_fundamental)::integer as completed_additional_cases,
    count(i.id) filter (
      where i.status = 'backlog'
        and exists (
          select 1
          from unnest(i.labels) as label
          where lower(trim(label)) = 'validado'
        )
    )::integer as approved_work_remaining,
    min(i.updated_at) filter (where i.status = 'completed') as first_completed_at,
    min(i.updated_at) filter (where i.status = 'completed' and not i.is_fundamental) as first_additional_completed_at,
    max(i.updated_at) filter (where i.status = 'completed') as last_completed_at,
    coalesce(sum(i.credits) filter (where i.status in ('planned', 'executing')), 0)::integer as reserved_credits,
    coalesce(sum(i.credits) filter (where i.status = 'completed'), 0)::integer as consumed_credits,
    coalesce(config.lost_credits, 0)::integer as lost_credits,
    coalesce(config.extra_capacity, 0)::integer as extra_capacity,
    case
      when coalesce(config.north_star_status, 'pending') = 'completed' then 1
      else 0
    end::integer as north_stars_completed
  from public.clients c
  left join public.profiles csm
    on csm.id = c.csm_user_id
  left join public.onboarding_configs config
    on config.client_id = c.id
  left join initiative_credits i
    on i.client_id = c.id
  group by c.id, c.name, c.slug, c.csm_user_id, c.created_at, csm.full_name, csm.email, config.start_date, config.north_star_completed_at, config.custom_plan_billing_mode, config.lost_credits, config.extra_capacity, config.north_star_status
),
credit_rollup as (
  select
    g.client_id,
    coalesce(sum(greatest(g.granted_credits - g.used_credits - g.expired_credits, 0)) filter (where g.expires_at >= current_date), 0)::integer as active_credits
  from public.client_credit_grants g
  group by g.client_id
),
signals as (
  select
    r.*,
    greatest(
      0,
      current_date - coalesce(r.last_completed_at::date, r.start_date)
    )::integer as days_without_progress,
    greatest(
      coalesce(cr.active_credits, 0) + r.extra_capacity - r.reserved_credits - r.consumed_credits - r.lost_credits,
      0
    )::integer as credits_remaining,
    case
      when r.approved_work_remaining = 0 then 'neutral'
      when current_date - coalesce(r.last_completed_at::date, r.start_date) <= 7 then 'green'
      when current_date - coalesce(r.last_completed_at::date, r.start_date) <= 14 then 'yellow'
      else 'red'
    end as movement_signal,
    case
      when r.approved_work_remaining >= 3 then 'green'
      when r.approved_work_remaining >= 1 then 'yellow'
      else 'red'
    end as plan_signal,
    case
      when greatest(coalesce(cr.active_credits, 0) + r.extra_capacity - r.reserved_credits - r.consumed_credits - r.lost_credits, 0) >= 3 then 'green'
      when greatest(coalesce(cr.active_credits, 0) + r.extra_capacity - r.reserved_credits - r.consumed_credits - r.lost_credits, 0) >= 1 then 'yellow'
      else 'red'
    end as credits_signal,
    case
      when r.first_additional_completed_at is not null then null
      when r.north_star_completed_date is null then 'yellow'
      when current_date - r.north_star_completed_date <= 10 then 'green'
      when current_date - r.north_star_completed_date <= 14 then 'yellow'
      else 'red'
    end as first_case_signal,
    case
      when r.first_additional_completed_at is not null
        and r.north_star_completed_date is not null
        and r.first_additional_completed_at::date <= r.north_star_completed_date + 14 then 'si'
      when r.first_additional_completed_at is not null then 'no'
      when r.north_star_completed_date is null then 'en riesgo'
      when current_date - r.north_star_completed_date <= 10 then 'si'
      when current_date - r.north_star_completed_date <= 14 then 'en riesgo'
      else 'no'
    end as first_case_on_time,
    case
      when r.total_cases = 0 then 'entrada'
      when r.completed_additional_cases = 0 then 'primer caso'
      when r.billing_mode = 'subscription' and r.north_stars_completed >= 1 then 'recurrencia'
      else 'construyendo'
    end as stage
  from client_rollup r
  left join credit_rollup cr
    on cr.client_id = r.client_id
)
select
  client_id,
  client_name,
  client_slug,
  customer_success_id,
  customer_success_name,
  customer_success_email,
  case
    when 'red' in (movement_signal, plan_signal, credits_signal, coalesce(first_case_signal, 'green')) then 'red'
    when 'yellow' in (movement_signal, plan_signal, credits_signal, coalesce(first_case_signal, 'green')) then 'yellow'
    else 'green'
  end as health_color,
  stage,
  first_case_on_time,
  days_without_progress,
  approved_work_remaining,
  credits_remaining,
  north_stars_completed,
  case
    when billing_mode = 'one_time' then 'paquetes'
    else 'recurrencia'
  end as billing,
  movement_signal,
  plan_signal,
  credits_signal,
  first_case_signal,
  start_date,
  first_completed_at,
  last_completed_at
from signals;

grant select on public.client_health_report to authenticated, service_role;
