create table if not exists public.client_extra_credit_purchases (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null,
  granted_credits integer not null check (granted_credits > 0),
  grant_id uuid not null references public.client_credit_grants(id) on delete restrict,
  paid_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint client_extra_credit_purchases_payment_ref_check
    check (stripe_checkout_session_id is not null or stripe_payment_intent_id is not null)
);

create index if not exists client_extra_credit_purchases_client_paid_idx
on public.client_extra_credit_purchases (client_id, paid_at desc);

drop trigger if exists set_client_extra_credit_purchases_updated_at on public.client_extra_credit_purchases;
create trigger set_client_extra_credit_purchases_updated_at
before update on public.client_extra_credit_purchases
for each row execute procedure public.set_current_timestamp_updated_at();

create or replace function public.record_extra_credit_package_payment(
  p_client_id uuid,
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_amount_cents integer,
  p_currency text,
  p_granted_credits integer default 80
)
returns public.client_extra_credit_purchases
language plpgsql
security definer
set search_path = public
as $$
declare
  target_config public.onboarding_configs;
  existing_purchase public.client_extra_credit_purchases;
  created_grant public.client_credit_grants;
  advisory_key text;
begin
  advisory_key := coalesce(nullif(p_checkout_session_id, ''), nullif(p_payment_intent_id, ''));

  if advisory_key is null then
    raise exception 'Stripe payment reference required';
  end if;

  if coalesce(p_granted_credits, 0) <= 0 then
    raise exception 'Granted credits must be positive';
  end if;

  perform pg_advisory_xact_lock(hashtext(advisory_key));

  select *
  into existing_purchase
  from public.client_extra_credit_purchases
  where stripe_checkout_session_id = p_checkout_session_id
     or (
       p_payment_intent_id is not null
       and stripe_payment_intent_id = p_payment_intent_id
     )
  limit 1;

  if existing_purchase.id is not null then
    return existing_purchase;
  end if;

  select *
  into target_config
  from public.onboarding_configs
  where client_id = p_client_id
  limit 1;

  if target_config.client_id is null then
    raise exception 'Onboarding config not found';
  end if;

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
    null,
    'manual_adjustment',
    p_granted_credits,
    current_date,
    (current_date + (coalesce(target_config.credit_validity_days, 60) || ' days')::interval)::date
  )
  returning *
  into created_grant;

  insert into public.client_extra_credit_purchases (
    client_id,
    stripe_checkout_session_id,
    stripe_payment_intent_id,
    amount_cents,
    currency,
    granted_credits,
    grant_id,
    paid_at
  )
  values (
    p_client_id,
    nullif(p_checkout_session_id, ''),
    nullif(p_payment_intent_id, ''),
    p_amount_cents,
    lower(p_currency),
    p_granted_credits,
    created_grant.id,
    timezone('utc', now())
  )
  returning *
  into existing_purchase;

  perform public.expire_unused_client_credits(p_client_id);

  return existing_purchase;
end;
$$;

alter table public.client_extra_credit_purchases enable row level security;

drop policy if exists "extra_credit_purchases_select_accessible" on public.client_extra_credit_purchases;
drop policy if exists "extra_credit_purchases_manage_owner" on public.client_extra_credit_purchases;

create policy "extra_credit_purchases_select_accessible"
on public.client_extra_credit_purchases
for select
to authenticated
using (public.can_view_client(client_id));

create policy "extra_credit_purchases_manage_owner"
on public.client_extra_credit_purchases
for all
to authenticated
using (public.current_client_role(client_id) = 'owner')
with check (public.current_client_role(client_id) = 'owner');

revoke execute on function public.record_extra_credit_package_payment(uuid, text, text, integer, text, integer)
from public, anon, authenticated;
grant execute on function public.record_extra_credit_package_payment(uuid, text, text, integer, text, integer)
to service_role;
