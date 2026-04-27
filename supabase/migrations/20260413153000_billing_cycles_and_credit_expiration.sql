-- Incremental migration for monthly billing cycles, Stripe payment recording,
-- and 60-day unused credit expiration.

create table if not exists public.client_billing_cycles (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  cycle_start_date date not null,
  cycle_end_date date not null,
  status text not null default 'unpaid' check (status in ('unpaid', 'paid', 'void')),
  paid_at timestamptz,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  amount_cents integer check (amount_cents is null or amount_cents >= 0),
  currency text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (client_id, cycle_start_date)
);

create table if not exists public.client_credit_grants (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  billing_cycle_id uuid references public.client_billing_cycles(id) on delete cascade,
  source text not null default 'monthly_cycle' check (source in ('monthly_cycle', 'manual_adjustment')),
  granted_credits integer not null check (granted_credits >= 0),
  used_credits integer not null default 0 check (used_credits >= 0),
  expired_credits integer not null default 0 check (expired_credits >= 0),
  grant_date date not null default current_date,
  expires_at date not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint client_credit_grants_valid_usage check (used_credits + expired_credits <= granted_credits)
);

create index if not exists client_billing_cycles_client_cycle_idx
on public.client_billing_cycles (client_id, cycle_start_date desc);

create index if not exists client_billing_cycles_paid_idx
on public.client_billing_cycles (client_id, status, paid_at desc);

create index if not exists client_credit_grants_client_expiration_idx
on public.client_credit_grants (client_id, expires_at);

create unique index if not exists client_credit_grants_billing_cycle_unique_idx
on public.client_credit_grants (billing_cycle_id)
where billing_cycle_id is not null;

drop trigger if exists set_client_billing_cycles_updated_at on public.client_billing_cycles;
create trigger set_client_billing_cycles_updated_at
before update on public.client_billing_cycles
for each row execute procedure public.set_current_timestamp_updated_at();

drop trigger if exists set_client_credit_grants_updated_at on public.client_credit_grants;
create trigger set_client_credit_grants_updated_at
before update on public.client_credit_grants
for each row execute procedure public.set_current_timestamp_updated_at();

create or replace function public.sync_client_assignment_members()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.client_members
  where client_id = new.id
    and profile_role = 'sales'
    and user_id is distinct from new.seller_user_id
    and user_id <> new.owner_user_id;

  delete from public.client_members
  where client_id = new.id
    and profile_role = 'csm'
    and user_id is distinct from new.csm_user_id
    and user_id <> new.owner_user_id;

  if new.seller_user_id is not null
     and new.seller_user_id <> new.owner_user_id
     and (new.csm_user_id is null or new.seller_user_id <> new.csm_user_id) then
    insert into public.client_members (
      client_id,
      user_id,
      access_role,
      profile_role,
      added_by_user_id
    )
    values (
      new.id,
      new.seller_user_id,
      'editor',
      'sales',
      new.owner_user_id
    )
    on conflict (client_id, user_id) do update
      set access_role = excluded.access_role,
          profile_role = excluded.profile_role,
          added_by_user_id = excluded.added_by_user_id,
          updated_at = timezone('utc', now());
  end if;

  if new.csm_user_id is not null
     and new.csm_user_id <> new.owner_user_id then
    insert into public.client_members (
      client_id,
      user_id,
      access_role,
      profile_role,
      added_by_user_id
    )
    values (
      new.id,
      new.csm_user_id,
      'editor',
      'csm',
      new.owner_user_id
    )
    on conflict (client_id, user_id) do update
      set access_role = excluded.access_role,
          profile_role = excluded.profile_role,
          added_by_user_id = excluded.added_by_user_id,
          updated_at = timezone('utc', now());
  end if;

  return new;
end;
$$;

drop trigger if exists sync_client_assignment_members_on_write on public.clients;
create trigger sync_client_assignment_members_on_write
after insert or update of seller_user_id, csm_user_id, owner_user_id on public.clients
for each row execute procedure public.sync_client_assignment_members();

update public.client_members cm
set access_role = 'editor',
    updated_at = timezone('utc', now())
from public.clients c
where cm.client_id = c.id
  and cm.user_id = c.seller_user_id
  and cm.profile_role = 'sales'
  and cm.access_role = 'viewer';

create or replace function public.get_client_cycle_window(
  p_client_id uuid,
  p_reference_date date default current_date
)
returns table (
  cycle_start_date date,
  cycle_end_date date
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target_config public.onboarding_configs;
  anchor_day integer;
  target_month date;
  days_in_month integer;
  computed_start date;
begin
  select *
  into target_config
  from public.onboarding_configs
  where client_id = p_client_id
  limit 1;

  anchor_day := extract(day from coalesce(target_config.start_date, p_reference_date))::integer;
  target_month := date_trunc('month', p_reference_date)::date;
  days_in_month := extract(day from (target_month + interval '1 month - 1 day'))::integer;
  computed_start := make_date(
    extract(year from target_month)::integer,
    extract(month from target_month)::integer,
    least(anchor_day, days_in_month)
  );

  if p_reference_date < computed_start then
    target_month := (target_month - interval '1 month')::date;
    days_in_month := extract(day from (target_month + interval '1 month - 1 day'))::integer;
    computed_start := make_date(
      extract(year from target_month)::integer,
      extract(month from target_month)::integer,
      least(anchor_day, days_in_month)
    );
  end if;

  return query
  select
    computed_start,
    (computed_start + interval '1 month - 1 day')::date;
end;
$$;

create or replace function public.expire_unused_client_credits(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  declare
    used_remaining integer;
    grant_record record;
    allocated_used integer;
    next_expired integer;
  begin
    select coalesce(sum(s.unit_credits * s.quantity), 0)
    into used_remaining
    from public.onboarding_initiatives i
    join public.onboarding_initiative_subitems s
      on s.initiative_id = i.id
    where i.client_id = p_client_id
      and i.status in ('planned', 'executing', 'completed');

    for grant_record in
      select *
      from public.client_credit_grants
      where client_id = p_client_id
      order by grant_date asc, created_at asc
    loop
      allocated_used := least(grant_record.granted_credits, greatest(used_remaining, 0));
      used_remaining := greatest(used_remaining - allocated_used, 0);

      next_expired := case
        when grant_record.expires_at < current_date
          then greatest(grant_record.granted_credits - allocated_used, 0)
        else 0
      end;

      update public.client_credit_grants
      set used_credits = allocated_used,
          expired_credits = next_expired,
          updated_at = timezone('utc', now())
      where id = grant_record.id;
    end loop;
  end;
end;
$$;

create or replace function public.get_client_billing_status(p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cycle_window record;
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
  paid_cycle public.client_billing_cycles;
  plan_credits integer;
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
    cycle_window.cycle_start_date,
    cycle_window.cycle_end_date,
    'paid',
    timezone('utc', now()),
    p_checkout_session_id,
    p_payment_intent_id,
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
        amount_cents = excluded.amount_cents,
        currency = excluded.currency,
        updated_at = timezone('utc', now())
  returning *
  into paid_cycle;

  plan_credits := coalesce(target_config.custom_plan_credits, target_config.base_capacity);
  credit_validity := target_config.credit_validity_days;

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
    plan_credits,
    cycle_window.cycle_start_date,
    (cycle_window.cycle_start_date + (credit_validity || ' days')::interval)::date
  )
  on conflict (billing_cycle_id) where billing_cycle_id is not null do update
    set granted_credits = excluded.granted_credits,
        expires_at = excluded.expires_at,
        updated_at = timezone('utc', now());

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
      raise exception 'El ciclo mensual debe estar pagado para usar Planificado o En ejecucion';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_paid_cycle_for_reserved_initiatives_on_write on public.onboarding_initiatives;
create trigger enforce_paid_cycle_for_reserved_initiatives_on_write
before insert or update of status on public.onboarding_initiatives
for each row execute procedure public.enforce_paid_cycle_for_reserved_initiatives();

alter table public.client_billing_cycles enable row level security;
alter table public.client_credit_grants enable row level security;

drop policy if exists "billing_cycles_select_accessible" on public.client_billing_cycles;
drop policy if exists "billing_cycles_manage_owner" on public.client_billing_cycles;
drop policy if exists "credit_grants_select_accessible" on public.client_credit_grants;
drop policy if exists "credit_grants_manage_owner" on public.client_credit_grants;

create policy "billing_cycles_select_accessible"
on public.client_billing_cycles
for select
to authenticated
using (public.can_view_client(client_id));

create policy "billing_cycles_manage_owner"
on public.client_billing_cycles
for all
to authenticated
using (public.current_client_role(client_id) = 'owner')
with check (public.current_client_role(client_id) = 'owner');

create policy "credit_grants_select_accessible"
on public.client_credit_grants
for select
to authenticated
using (public.can_view_client(client_id));

create policy "credit_grants_manage_owner"
on public.client_credit_grants
for all
to authenticated
using (public.current_client_role(client_id) = 'owner')
with check (public.current_client_role(client_id) = 'owner');

grant execute on function public.get_client_cycle_window(uuid, date) to authenticated;
grant execute on function public.expire_unused_client_credits(uuid) to authenticated;
grant execute on function public.get_client_billing_status(uuid) to authenticated, service_role;
revoke execute on function public.record_stripe_checkout_payment(uuid, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.record_stripe_checkout_payment(uuid, text, text, integer, text) to service_role;
grant execute on function public.get_public_onboarding_snapshot(text) to anon, authenticated;
