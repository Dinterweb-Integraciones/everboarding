update public.onboarding_configs
set credit_validity_days = 90,
    updated_at = timezone('utc', now())
where custom_plan_billing_mode = 'one_time'
  and credit_validity_days < 90;

update public.client_credit_grants grants
set grant_date = coalesce(cycles.paid_at::date, grants.grant_date),
    expires_at = (
      coalesce(cycles.paid_at::date, grants.grant_date)
      + (configs.credit_validity_days || ' days')::interval
    )::date,
    updated_at = timezone('utc', now())
from public.client_billing_cycles cycles
join public.onboarding_configs configs
  on configs.client_id = cycles.client_id
where grants.billing_cycle_id = cycles.id
  and configs.custom_plan_billing_mode = 'one_time';

create or replace function public.get_client_billing_status(p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cycle_window record;
  target_config public.onboarding_configs;
  paid_cycle public.client_billing_cycles;
  active_grant public.client_credit_grants;
  active_credits integer;
  expired_unused_credits integer;
  next_expiration_date date;
  billing_mode text;
begin
  if auth.uid() is not null and not public.can_view_client(p_client_id) then
    raise exception 'Access denied';
  end if;

  perform public.expire_unused_client_credits(p_client_id);

  select *
  into target_config
  from public.onboarding_configs
  where client_id = p_client_id
  limit 1;

  billing_mode := coalesce(target_config.custom_plan_billing_mode::text, 'subscription');

  select *
  into cycle_window
  from public.get_client_cycle_window(p_client_id, current_date)
  limit 1;

  select *
  into paid_cycle
  from public.client_billing_cycles
  where client_id = p_client_id
    and cycle_start_date = cycle_window.cycle_start_date
    and status = 'paid'
  order by paid_at desc nulls last
  limit 1;

  select coalesce(sum(greatest(granted_credits - used_credits - expired_credits, 0)), 0)
  into active_credits
  from public.client_credit_grants
  where client_id = p_client_id
    and expires_at >= current_date;

  if billing_mode = 'one_time' and active_credits > 0 then
    select *
    into active_grant
    from public.client_credit_grants
    where client_id = p_client_id
      and expires_at >= current_date
      and granted_credits - used_credits - expired_credits > 0
    order by expires_at desc, grant_date desc, created_at desc
    limit 1;

    select *
    into paid_cycle
    from public.client_billing_cycles
    where client_id = p_client_id
      and id = active_grant.billing_cycle_id
    limit 1;

    if active_grant.id is not null then
      cycle_window.cycle_start_date := active_grant.grant_date;
      cycle_window.cycle_end_date := active_grant.expires_at;
    end if;
  elsif paid_cycle.id is null and billing_mode = 'one_time' then
    select *
    into paid_cycle
    from public.client_billing_cycles
    where client_id = p_client_id
      and status = 'paid'
    order by paid_at desc nulls last, created_at desc
    limit 1;
  end if;

  select coalesce(sum(expired_credits), 0)
  into expired_unused_credits
  from public.client_credit_grants
  where client_id = p_client_id;

  select min(expires_at)
  into next_expiration_date
  from public.client_credit_grants
  where client_id = p_client_id
    and expires_at >= current_date
    and granted_credits - used_credits - expired_credits > 0;

  return jsonb_build_object(
    'current_cycle_paid', case when billing_mode = 'one_time' then active_credits > 0 else paid_cycle.id is not null end,
    'current_cycle_start', cycle_window.cycle_start_date,
    'current_cycle_end', cycle_window.cycle_end_date,
    'active_credits', active_credits,
    'expired_unused_credits', expired_unused_credits,
    'next_expiration_date', next_expiration_date,
    'paid_at', paid_cycle.paid_at
  );
end;
$$;

create or replace function public.record_stripe_checkout_payment(
  p_client_id uuid,
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_amount_cents integer,
  p_currency text,
  p_stripe_subscription_id text default null,
  p_stripe_invoice_id text default null
)
returns public.client_billing_cycles
language plpgsql
security definer
set search_path = public
as $$
declare
  target_config public.onboarding_configs;
  cycle_window record;
  target_cycle record;
  paid_cycle public.client_billing_cycles;
  contract_credits integer;
  period_months integer;
  month_index integer;
  monthly_base integer;
  monthly_remainder integer;
  cycle_credits integer;
  credit_validity integer;
  billing_mode text;
begin
  select *
  into target_config
  from public.onboarding_configs
  where client_id = p_client_id
  limit 1;

  if target_config.client_id is null then
    raise exception 'Onboarding config not found';
  end if;

  select *
  into cycle_window
  from public.get_client_cycle_window(p_client_id, current_date)
  limit 1;

  period_months := coalesce(target_config.custom_plan_period_months, 1);
  if period_months not in (1, 3, 6, 12) then
    period_months := 1;
  end if;

  contract_credits := coalesce(target_config.custom_plan_credits, target_config.base_capacity * period_months);
  monthly_base := floor(contract_credits::numeric / period_months)::integer;
  monthly_remainder := mod(contract_credits, period_months);
  credit_validity := target_config.credit_validity_days;
  billing_mode := coalesce(target_config.custom_plan_billing_mode::text, 'subscription');

  if billing_mode = 'one_time' then
    insert into public.client_billing_cycles (
      client_id,
      cycle_start_date,
      cycle_end_date,
      status,
      paid_at,
      stripe_checkout_session_id,
      stripe_payment_intent_id,
      stripe_subscription_id,
      stripe_invoice_id,
      amount_cents,
      currency
    )
    values (
      p_client_id,
      current_date,
      (current_date + ((credit_validity - 1) || ' days')::interval)::date,
      'paid',
      timezone('utc', now()),
      p_checkout_session_id,
      p_payment_intent_id,
      p_stripe_subscription_id,
      p_stripe_invoice_id,
      p_amount_cents,
      lower(p_currency)
    )
    on conflict (client_id, cycle_start_date) do update
      set status = 'paid',
          paid_at = coalesce(public.client_billing_cycles.paid_at, excluded.paid_at),
          stripe_checkout_session_id = coalesce(
            public.client_billing_cycles.stripe_checkout_session_id,
            excluded.stripe_checkout_session_id
          ),
          stripe_payment_intent_id = coalesce(
            public.client_billing_cycles.stripe_payment_intent_id,
            excluded.stripe_payment_intent_id
          ),
          stripe_subscription_id = coalesce(
            public.client_billing_cycles.stripe_subscription_id,
            excluded.stripe_subscription_id
          ),
          stripe_invoice_id = coalesce(
            public.client_billing_cycles.stripe_invoice_id,
            excluded.stripe_invoice_id
          ),
          amount_cents = coalesce(public.client_billing_cycles.amount_cents, excluded.amount_cents),
          currency = excluded.currency,
          updated_at = timezone('utc', now())
    returning *
    into paid_cycle;

    insert into public.client_credit_grants (
      client_id,
      billing_cycle_id,
      source,
      granted_credits,
      grant_date,
      expires_at
    )
    values (
      p_client_id,
      paid_cycle.id,
      'monthly_cycle',
      contract_credits,
      current_date,
      (current_date + (credit_validity || ' days')::interval)::date
    )
    on conflict (billing_cycle_id) where billing_cycle_id is not null do update
      set granted_credits = excluded.granted_credits,
          expires_at = excluded.expires_at,
          updated_at = timezone('utc', now());

    perform public.expire_unused_client_credits(p_client_id);
    return paid_cycle;
  end if;

  for month_index in 0..(period_months - 1) loop
    select *
    into target_cycle
    from public.get_client_cycle_window(
      p_client_id,
      (cycle_window.cycle_start_date + (month_index || ' months')::interval)::date
    )
    limit 1;

    cycle_credits := monthly_base + case when month_index < monthly_remainder then 1 else 0 end;

    insert into public.client_billing_cycles (
      client_id,
      cycle_start_date,
      cycle_end_date,
      status,
      paid_at,
      stripe_checkout_session_id,
      stripe_payment_intent_id,
      stripe_subscription_id,
      stripe_invoice_id,
      amount_cents,
      currency
    )
    values (
      p_client_id,
      target_cycle.cycle_start_date,
      target_cycle.cycle_end_date,
      'paid',
      timezone('utc', now()),
      p_checkout_session_id,
      p_payment_intent_id,
      p_stripe_subscription_id,
      p_stripe_invoice_id,
      case when month_index = 0 then p_amount_cents else null end,
      lower(p_currency)
    )
    on conflict (client_id, cycle_start_date) do update
      set status = 'paid',
          paid_at = coalesce(public.client_billing_cycles.paid_at, excluded.paid_at),
          stripe_checkout_session_id = coalesce(
            public.client_billing_cycles.stripe_checkout_session_id,
            excluded.stripe_checkout_session_id
          ),
          stripe_payment_intent_id = coalesce(
            public.client_billing_cycles.stripe_payment_intent_id,
            excluded.stripe_payment_intent_id
          ),
          stripe_subscription_id = coalesce(
            public.client_billing_cycles.stripe_subscription_id,
            excluded.stripe_subscription_id
          ),
          stripe_invoice_id = coalesce(
            public.client_billing_cycles.stripe_invoice_id,
            excluded.stripe_invoice_id
          ),
          amount_cents = coalesce(public.client_billing_cycles.amount_cents, excluded.amount_cents),
          currency = excluded.currency,
          updated_at = timezone('utc', now())
    returning *
    into paid_cycle;

    insert into public.client_credit_grants (
      client_id,
      billing_cycle_id,
      source,
      granted_credits,
      grant_date,
      expires_at
    )
    values (
      p_client_id,
      paid_cycle.id,
      'monthly_cycle',
      cycle_credits,
      target_cycle.cycle_start_date,
      (target_cycle.cycle_start_date + (credit_validity || ' days')::interval)::date
    )
    on conflict (billing_cycle_id) where billing_cycle_id is not null do update
      set granted_credits = excluded.granted_credits,
          expires_at = excluded.expires_at,
          updated_at = timezone('utc', now());
  end loop;

  perform public.expire_unused_client_credits(p_client_id);

  return paid_cycle;
end;
$$;

create or replace function public.enforce_paid_cycle_for_reserved_initiatives()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  billing_status jsonb;
begin
  if new.status in ('planned', 'executing')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    billing_status := public.get_client_billing_status(new.client_id);

    if not coalesce((billing_status ->> 'current_cycle_paid')::boolean, false) then
      raise exception 'El cliente debe tener un pago activo o creditos vigentes para usar Planificado o En ejecucion';
    end if;
  end if;

  return new;
end;
$$;
