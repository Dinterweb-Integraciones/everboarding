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
  active_credits integer;
  expired_unused_credits integer;
  next_expiration_date date;
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

  if paid_cycle.id is null and coalesce(target_config.custom_plan_billing_mode, 'subscription') = 'subscription' then
    null;
  elsif paid_cycle.id is null then
    select *
    into paid_cycle
    from public.client_billing_cycles
    where client_id = p_client_id
      and status = 'paid'
    order by paid_at desc nulls last, created_at desc
    limit 1;
  end if;

  select coalesce(sum(granted_credits), 0)
  into active_credits
  from public.client_credit_grants
  where client_id = p_client_id;

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
    'current_cycle_paid', paid_cycle.id is not null,
    'current_cycle_start', cycle_window.cycle_start_date,
    'current_cycle_end', cycle_window.cycle_end_date,
    'active_credits', active_credits,
    'expired_unused_credits', expired_unused_credits,
    'next_expiration_date', next_expiration_date,
    'paid_at', paid_cycle.paid_at
  );
end;
$$;
