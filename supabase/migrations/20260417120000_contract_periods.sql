-- Adds negotiated contract periods and monthly credit distribution.

alter table public.onboarding_configs
add column if not exists custom_plan_period_months integer not null default 1;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'onboarding_configs_custom_plan_period_months_check'
      and conrelid = 'public.onboarding_configs'::regclass
  ) then
    alter table public.onboarding_configs
      add constraint onboarding_configs_custom_plan_period_months_check
      check (custom_plan_period_months in (1, 3, 6, 12));
  end if;
end;
$$;

alter table public.client_billing_cycles
drop constraint if exists client_billing_cycles_stripe_checkout_session_id_key;

create index if not exists client_billing_cycles_stripe_checkout_session_idx
on public.client_billing_cycles (stripe_checkout_session_id);

create or replace function public.record_stripe_checkout_payment(
  p_client_id uuid,
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_amount_cents integer,
  p_currency text
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

grant execute on function public.record_stripe_checkout_payment(uuid, text, text, integer, text) to service_role;
