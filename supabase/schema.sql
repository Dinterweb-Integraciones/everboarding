create extension if not exists pgcrypto;

create type public.client_access_role as enum ('viewer', 'editor', 'owner');
create type public.client_profile_role as enum ('sales', 'csm', 'client', 'stakeholder');
create type public.platform_role as enum ('superadmin', 'admin', 'sales', 'csm', 'finance');
create type public.initiative_status as enum ('backlog', 'planned', 'executing', 'completed');
create type public.initiative_task_status as enum ('pending', 'in_progress', 'blocked', 'completed');
create type public.custom_plan_type as enum ('mensual', 'proyecto');
create type public.custom_plan_billing_mode as enum ('subscription', 'one_time');
create type public.project_stage as enum ('sales', 'cs', 'client');
create type public.sales_proposal_status as enum ('draft', 'checkout_pending', 'transfer_pending', 'paid', 'board_activated', 'archived');
create type public.sales_payment_method as enum ('stripe', 'bank_transfer');

create or replace function public.set_current_timestamp_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  platform_role public.platform_role,
  is_platform_active boolean not null default false,
  platform_invited_by_user_id uuid references auth.users(id) on delete set null,
  platform_invited_at timestamptz,
  platform_activated_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.platform_user_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  full_name text,
  role public.platform_role not null,
  invited_by_user_id uuid references auth.users(id) on delete set null,
  invited_user_id uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  seller_user_id uuid references auth.users(id) on delete set null,
  csm_user_id uuid references auth.users(id) on delete set null,
  name text not null,
  slug text not null unique default replace(gen_random_uuid()::text, '-', ''),
  description text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.sales_proposals (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique default replace(gen_random_uuid()::text, '-', ''),
  title text not null default 'Propuesta comercial',
  seller_name text,
  seller_email text,
  seller_company text,
  client_name text not null,
  client_email text,
  client_company text,
  client_phone text,
  client_description text,
  assigned_csm_user_id uuid references auth.users(id) on delete set null,
  start_date date not null default current_date,
  contracted_credits integer not null default 80 check (contracted_credits >= 0),
  quoted_price numeric(10, 2) not null default 0 check (quoted_price >= 0),
  currency text not null default 'usd',
  billing_mode public.custom_plan_billing_mode not null default 'subscription',
  plan_period_months integer not null default 1 check (plan_period_months in (1, 3, 6, 12)),
  status public.sales_proposal_status not null default 'draft',
  payment_method public.sales_payment_method not null default 'stripe',
  snapshot jsonb not null default '{"initiatives":[]}'::jsonb,
  hubspot_deal_id text,
  hubspot_pipeline_id text,
  hubspot_deal_stage_id text,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  stripe_subscription_id text,
  activated_client_id uuid references public.clients(id) on delete set null,
  paid_at timestamptz,
  activated_at timestamptz,
  transfer_bank text,
  transfer_reference text,
  transfer_validated_at timestamptz,
  transfer_validated_by_user_id uuid references auth.users(id) on delete set null,
  last_synced_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.sales_proposal_snapshots (
  proposal_id uuid primary key references public.sales_proposals(id) on delete cascade,
  snapshot jsonb not null default '{"i":[]}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.sales_coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  coupon_type text not null default 'package_override' check (coupon_type in ('package_override', 'percentage')),
  granted_credits integer not null default 40 check (granted_credits >= 0),
  discounted_price numeric(10, 2) not null default 0 check (discounted_price >= 0),
  percentage_off numeric(5, 2) check (percentage_off is null or (percentage_off > 0 and percentage_off <= 100)),
  is_active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.sales_proposals
add column if not exists applied_coupon_id uuid references public.sales_coupons(id) on delete set null,
add column if not exists applied_coupon_code text,
add column if not exists coupon_applied_at timestamptz;

alter table public.clients
add column if not exists seller_user_id uuid references auth.users(id) on delete set null;

alter table public.clients
add column if not exists csm_user_id uuid references auth.users(id) on delete set null;

create table if not exists public.client_members (
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  access_role public.client_access_role not null,
  profile_role public.client_profile_role not null default 'stakeholder',
  added_by_user_id uuid references auth.users(id) on delete set null,
  accepted_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (client_id, user_id),
  constraint client_members_no_owner_role check (access_role <> 'owner')
);

create table if not exists public.client_share_links (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  access_role public.client_access_role not null,
  profile_role public.client_profile_role not null default 'stakeholder',
  stage_scope public.project_stage not null default 'client',
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  use_count integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint client_share_links_no_owner_role check (access_role <> 'owner')
);

create table if not exists public.credit_catalog_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  modal_category text,
  credits integer not null default 0 check (credits >= 0),
  priority_status text not null default 'normal' check (priority_status in ('normal', 'prioritario')),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.credit_catalog_group_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.credit_catalog_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.credit_catalog_items (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  label text not null unique,
  credits integer not null check (credits > 0),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.credit_catalog_group_items (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.credit_catalog_groups(id) on delete cascade,
  catalog_item_id uuid not null references public.credit_catalog_items(id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  unique (group_id, catalog_item_id)
);

alter table public.credit_catalog_groups
add column if not exists modal_category_id uuid references public.credit_catalog_group_categories(id) on delete set null;

create table if not exists public.credit_catalog_group_category_links (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.credit_catalog_groups(id) on delete cascade,
  category_id uuid not null references public.credit_catalog_group_categories(id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  unique (group_id, category_id)
);

create table if not exists public.managed_prompts (
  id uuid primary key default gen_random_uuid(),
  singleton_key text not null default 'default',
  prompt_text text not null check (nullif(trim(prompt_text), '') is not null),
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.onboarding_configs (
  client_id uuid primary key references public.clients(id) on delete cascade,
  start_date date not null default current_date,
  base_capacity integer not null default 80 check (base_capacity >= 0),
  extra_capacity integer not null default 0 check (extra_capacity >= 0),
  lost_credits integer not null default 0 check (lost_credits >= 0),
  custom_plan_credits integer check (custom_plan_credits is null or custom_plan_credits >= 0),
  custom_plan_price numeric(10, 2) check (custom_plan_price is null or custom_plan_price >= 0),
  custom_plan_type public.custom_plan_type,
  custom_plan_billing_mode public.custom_plan_billing_mode not null default 'subscription',
  custom_plan_period_months integer not null default 1 check (custom_plan_period_months in (1, 3, 6, 12)),
  current_stage public.project_stage not null default 'cs',
  credit_validity_days integer not null default 60 check (credit_validity_days > 0),
  show_all_completed boolean not null default false,
  sales_cleared boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by_user_id uuid references auth.users(id) on delete set null
);

alter table public.onboarding_configs
add column if not exists custom_plan_period_months integer not null default 1;

alter table public.onboarding_configs
add column if not exists custom_plan_billing_mode public.custom_plan_billing_mode not null default 'subscription';

update public.onboarding_configs
set custom_plan_billing_mode = 'one_time'
where custom_plan_type = 'proyecto'
  and custom_plan_billing_mode = 'subscription';

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

create table if not exists public.client_billing_cycles (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  sales_proposal_id uuid references public.sales_proposals(id) on delete set null,
  cycle_start_date date not null,
  cycle_end_date date not null,
  status text not null default 'unpaid' check (status in ('unpaid', 'paid', 'void')),
  paid_at timestamptz,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  stripe_subscription_id text,
  stripe_invoice_id text,
  amount_cents integer check (amount_cents is null or amount_cents >= 0),
  currency text,
  payment_method public.sales_payment_method not null default 'stripe',
  transfer_bank text,
  transfer_reference text,
  transfer_validated_at timestamptz,
  transfer_validated_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (client_id, cycle_start_date)
);

alter table public.client_billing_cycles
add column if not exists stripe_subscription_id text,
add column if not exists stripe_invoice_id text,
add column if not exists sales_proposal_id uuid references public.sales_proposals(id) on delete set null,
add column if not exists payment_method public.sales_payment_method not null default 'stripe',
add column if not exists transfer_bank text,
add column if not exists transfer_reference text,
add column if not exists transfer_validated_at timestamptz,
add column if not exists transfer_validated_by_user_id uuid references auth.users(id) on delete set null;

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

create table if not exists public.onboarding_initiatives (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  title text not null,
  type text,
  labels text[] not null default '{}'::text[],
  status public.initiative_status not null default 'backlog',
  description text,
  owner_client text,
  owner_csm text,
  est_start_date date,
  est_end_date date,
  date_planned date default current_date,
  last_activity date default current_date,
  is_blocked boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  created_by_user_id uuid references auth.users(id) on delete set null,
  updated_by_user_id uuid references auth.users(id) on delete set null
);

create table if not exists public.onboarding_initiative_subitems (
  id uuid primary key default gen_random_uuid(),
  initiative_id uuid not null references public.onboarding_initiatives(id) on delete cascade,
  catalog_item_id uuid references public.credit_catalog_items(id) on delete set null,
  name text not null,
  status public.initiative_task_status not null default 'pending',
  target_date date,
  unit_credits integer not null check (unit_credits >= 0),
  quantity integer not null default 1 check (quantity > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.onboarding_initiatives
add column if not exists labels text[] not null default '{}'::text[];

alter table public.onboarding_initiative_subitems
add column if not exists status public.initiative_task_status not null default 'pending',
add column if not exists target_date date;

create table if not exists public.onboarding_activity_logs (
  id uuid primary key default gen_random_uuid(),
  initiative_id uuid not null references public.onboarding_initiatives(id) on delete cascade,
  entry text not null,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists clients_owner_user_id_idx on public.clients (owner_user_id);
create index if not exists clients_seller_user_id_idx on public.clients (seller_user_id);
create index if not exists clients_csm_user_id_idx on public.clients (csm_user_id);
create index if not exists clients_updated_at_idx on public.clients (updated_at desc);
create index if not exists client_members_user_id_idx on public.client_members (user_id);
create index if not exists client_share_links_client_id_idx on public.client_share_links (client_id, created_at desc);
create index if not exists client_billing_cycles_client_cycle_idx on public.client_billing_cycles (client_id, cycle_start_date desc);
create index if not exists client_billing_cycles_paid_idx on public.client_billing_cycles (client_id, status, paid_at desc);
create index if not exists client_billing_cycles_transfer_status_idx on public.client_billing_cycles (payment_method, status, cycle_start_date desc);
create index if not exists client_billing_cycles_sales_proposal_idx on public.client_billing_cycles (sales_proposal_id, cycle_start_date desc);
create index if not exists client_billing_cycles_stripe_checkout_session_idx on public.client_billing_cycles (stripe_checkout_session_id);
create index if not exists client_billing_cycles_stripe_subscription_idx on public.client_billing_cycles (stripe_subscription_id);
create index if not exists client_billing_cycles_stripe_invoice_idx on public.client_billing_cycles (stripe_invoice_id);
create index if not exists client_credit_grants_client_expiration_idx on public.client_credit_grants (client_id, expires_at);
create unique index if not exists client_credit_grants_billing_cycle_unique_idx
on public.client_credit_grants (billing_cycle_id)
where billing_cycle_id is not null;

alter table public.client_billing_cycles
drop constraint if exists client_billing_cycles_stripe_checkout_session_id_key;
create index if not exists onboarding_initiatives_client_status_idx on public.onboarding_initiatives (client_id, status, sort_order);
create index if not exists onboarding_subitems_initiative_id_idx on public.onboarding_initiative_subitems (initiative_id, sort_order);
create index if not exists onboarding_logs_initiative_id_idx on public.onboarding_activity_logs (initiative_id, created_at desc);
create index if not exists sales_proposals_status_idx on public.sales_proposals (status, updated_at desc);
create index if not exists sales_proposals_assigned_csm_user_id_idx on public.sales_proposals (assigned_csm_user_id);
create unique index if not exists sales_coupons_code_unique_idx on public.sales_coupons (lower(code));
create index if not exists sales_coupons_active_idx on public.sales_coupons (is_active, starts_at, ends_at);
create index if not exists credit_catalog_group_categories_sort_idx
on public.credit_catalog_group_categories (sort_order, name);
create index if not exists credit_catalog_categories_sort_idx
on public.credit_catalog_categories (sort_order, name);
create index if not exists credit_catalog_group_items_group_idx
on public.credit_catalog_group_items (group_id, sort_order);
create index if not exists credit_catalog_group_items_item_idx
on public.credit_catalog_group_items (catalog_item_id);
create index if not exists credit_catalog_group_category_links_group_idx
on public.credit_catalog_group_category_links (group_id);
create index if not exists credit_catalog_group_category_links_category_idx
on public.credit_catalog_group_category_links (category_id);
create index if not exists credit_catalog_group_category_links_category_sort_idx
on public.credit_catalog_group_category_links (category_id, sort_order, created_at);
create index if not exists managed_prompts_updated_idx
on public.managed_prompts (updated_at desc, created_at desc);
create unique index if not exists managed_prompts_singleton_key_idx
on public.managed_prompts (singleton_key);

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute procedure public.set_current_timestamp_updated_at();

drop trigger if exists set_platform_user_invites_updated_at on public.platform_user_invites;
create trigger set_platform_user_invites_updated_at
before update on public.platform_user_invites
for each row execute procedure public.set_current_timestamp_updated_at();

drop trigger if exists set_clients_updated_at on public.clients;
create trigger set_clients_updated_at
before update on public.clients
for each row execute procedure public.set_current_timestamp_updated_at();

drop trigger if exists set_sales_proposals_updated_at on public.sales_proposals;
create trigger set_sales_proposals_updated_at
before update on public.sales_proposals
for each row execute procedure public.set_current_timestamp_updated_at();

drop trigger if exists set_sales_proposal_snapshots_updated_at on public.sales_proposal_snapshots;
create trigger set_sales_proposal_snapshots_updated_at
before update on public.sales_proposal_snapshots
for each row execute procedure public.set_current_timestamp_updated_at();

drop trigger if exists set_sales_coupons_updated_at on public.sales_coupons;
create trigger set_sales_coupons_updated_at
before update on public.sales_coupons
for each row execute procedure public.set_current_timestamp_updated_at();

drop trigger if exists set_client_members_updated_at on public.client_members;
create trigger set_client_members_updated_at
before update on public.client_members
for each row execute procedure public.set_current_timestamp_updated_at();

drop trigger if exists set_client_share_links_updated_at on public.client_share_links;
create trigger set_client_share_links_updated_at
before update on public.client_share_links
for each row execute procedure public.set_current_timestamp_updated_at();

drop trigger if exists set_credit_catalog_items_updated_at on public.credit_catalog_items;
create trigger set_credit_catalog_items_updated_at
before update on public.credit_catalog_items
for each row execute procedure public.set_current_timestamp_updated_at();

drop trigger if exists set_credit_catalog_group_categories_updated_at on public.credit_catalog_group_categories;
create trigger set_credit_catalog_group_categories_updated_at
before update on public.credit_catalog_group_categories
for each row execute procedure public.set_current_timestamp_updated_at();

drop trigger if exists set_credit_catalog_categories_updated_at on public.credit_catalog_categories;
create trigger set_credit_catalog_categories_updated_at
before update on public.credit_catalog_categories
for each row execute procedure public.set_current_timestamp_updated_at();

drop trigger if exists set_credit_catalog_groups_updated_at on public.credit_catalog_groups;
create trigger set_credit_catalog_groups_updated_at
before update on public.credit_catalog_groups
for each row execute procedure public.set_current_timestamp_updated_at();

drop trigger if exists set_managed_prompts_updated_at on public.managed_prompts;
create trigger set_managed_prompts_updated_at
before update on public.managed_prompts
for each row execute procedure public.set_current_timestamp_updated_at();

drop trigger if exists set_onboarding_configs_updated_at on public.onboarding_configs;
create trigger set_onboarding_configs_updated_at
before update on public.onboarding_configs
for each row execute procedure public.set_current_timestamp_updated_at();

drop trigger if exists set_client_billing_cycles_updated_at on public.client_billing_cycles;
create trigger set_client_billing_cycles_updated_at
before update on public.client_billing_cycles
for each row execute procedure public.set_current_timestamp_updated_at();

drop trigger if exists set_client_credit_grants_updated_at on public.client_credit_grants;
create trigger set_client_credit_grants_updated_at
before update on public.client_credit_grants
for each row execute procedure public.set_current_timestamp_updated_at();

drop trigger if exists set_onboarding_initiatives_updated_at on public.onboarding_initiatives;
create trigger set_onboarding_initiatives_updated_at
before update on public.onboarding_initiatives
for each row execute procedure public.set_current_timestamp_updated_at();

drop trigger if exists set_onboarding_initiative_subitems_updated_at on public.onboarding_initiative_subitems;
create trigger set_onboarding_initiative_subitems_updated_at
before update on public.onboarding_initiative_subitems
for each row execute procedure public.set_current_timestamp_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = excluded.full_name,
        updated_at = timezone('utc', now());

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.initialize_client()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.onboarding_configs (client_id, updated_by_user_id)
  values (new.id, new.owner_user_id)
  on conflict (client_id) do nothing;

  return new;
end;
$$;

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

drop trigger if exists on_client_created on public.clients;
create trigger on_client_created
after insert on public.clients
for each row execute procedure public.initialize_client();

drop trigger if exists sync_client_assignment_members_on_write on public.clients;
create trigger sync_client_assignment_members_on_write
after insert or update of seller_user_id, csm_user_id, owner_user_id on public.clients
for each row execute procedure public.sync_client_assignment_members();

create or replace function public.current_client_role(target_client_id uuid)
returns public.client_access_role
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (
      select 1
      from public.clients c
      where c.id = target_client_id
        and c.owner_user_id = auth.uid()
    ) then 'owner'::public.client_access_role
    else (
      select cm.access_role
      from public.client_members cm
      where cm.client_id = target_client_id
        and cm.user_id = auth.uid()
      limit 1
    )
  end;
$$;

create or replace function public.can_view_client(target_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_client_role(target_client_id) is not null;
$$;

create or replace function public.can_edit_client(target_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_client_role(target_client_id) in ('owner', 'editor');
$$;

create or replace function public.can_view_profile(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    target_user_id = auth.uid()
    or exists (
      select 1
      from public.client_members my_membership
      join public.client_members target_membership
        on target_membership.client_id = my_membership.client_id
      where my_membership.user_id = auth.uid()
        and target_membership.user_id = target_user_id
    )
    or exists (
      select 1
      from public.clients c
      where c.owner_user_id = auth.uid()
        and exists (
          select 1
          from public.client_members cm
          where cm.client_id = c.id
            and cm.user_id = target_user_id
        )
    );
$$;

create or replace function public.redeem_client_share_link(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  active_link public.client_share_links;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select *
  into active_link
  from public.client_share_links
  where token = p_token
    and revoked_at is null
    and (expires_at is null or expires_at > timezone('utc', now()))
  limit 1;

  if active_link.id is null then
    raise exception 'Invalid or expired link';
  end if;

  update public.client_share_links
  set last_used_at = timezone('utc', now()),
      use_count = use_count + 1
  where id = active_link.id;

  if not exists (
    select 1
    from public.clients c
    where c.id = active_link.client_id
      and c.owner_user_id = auth.uid()
  ) then
    insert into public.client_members (client_id, user_id, access_role, profile_role, added_by_user_id)
    values (
      active_link.client_id,
      auth.uid(),
      active_link.access_role,
      active_link.profile_role,
      active_link.created_by_user_id
    )
    on conflict (client_id, user_id) do update
      set access_role = case
        when public.client_members.access_role = 'editor' or excluded.access_role = 'editor' then 'editor'
        else excluded.access_role
      end,
      profile_role = excluded.profile_role,
      updated_at = timezone('utc', now());
  end if;

  return active_link.client_id;
end;
$$;

create or replace function public.create_client(
  p_name text,
  p_description text default null,
  p_slug text default null,
  p_seller_user_id uuid default null,
  p_csm_user_id uuid default null
)
returns public.clients
language plpgsql
security definer
set search_path = public
as $$
declare
  created_client public.clients;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  insert into public.clients (
    owner_user_id,
    seller_user_id,
    csm_user_id,
    name,
    description,
    slug
  )
  values (
    auth.uid(),
    p_seller_user_id,
    p_csm_user_id,
    trim(p_name),
    nullif(trim(coalesce(p_description, '')), ''),
    coalesce(nullif(trim(coalesce(p_slug, '')), ''), replace(gen_random_uuid()::text, '-', ''))
  )
  returning *
  into created_client;

  return created_client;
end;
$$;

create or replace function public.list_assignable_profiles()
returns table (
  id uuid,
  email text,
  full_name text
)
language sql
security definer
set search_path = public
as $$
  select p.id, p.email, p.full_name
  from public.profiles p
  order by coalesce(nullif(trim(p.full_name), ''), p.email);
$$;

create or replace function public.add_client_member_by_email(
  p_client_id uuid,
  p_email text,
  p_access_role public.client_access_role,
  p_profile_role public.client_profile_role
)
returns public.client_members
language plpgsql
security definer
set search_path = public
as $$
declare
  target_profile public.profiles;
  updated_member public.client_members;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if public.current_client_role(p_client_id) <> 'owner' then
    raise exception 'Only the owner can add members';
  end if;

  if p_access_role = 'owner' then
    raise exception 'Owner role is not assignable';
  end if;

  select *
  into target_profile
  from public.profiles
  where lower(email) = lower(trim(p_email))
  limit 1;

  if target_profile.id is null then
    raise exception 'User not found';
  end if;

  if exists (
    select 1
    from public.clients c
    where c.id = p_client_id
      and c.owner_user_id = target_profile.id
  ) then
    raise exception 'This user already owns the client';
  end if;

  insert into public.client_members (
    client_id,
    user_id,
    access_role,
    profile_role,
    added_by_user_id
  )
  values (
    p_client_id,
    target_profile.id,
    p_access_role,
    p_profile_role,
    auth.uid()
  )
  on conflict (client_id, user_id) do update
    set access_role = excluded.access_role,
        profile_role = excluded.profile_role,
        added_by_user_id = excluded.added_by_user_id,
        updated_at = timezone('utc', now())
  returning *
  into updated_member;

  return updated_member;
end;
$$;

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

  if paid_cycle.id is null and coalesce(target_config.custom_plan_billing_mode, 'subscription') = 'one_time' then
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

create or replace function public.resolve_public_client_id(p_slug text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id
  from public.clients c
  where c.slug = trim(p_slug)
     or c.id::text = trim(p_slug)
  limit 1;
$$;

create or replace function public.get_public_onboarding_snapshot(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_client public.clients;
  target_config public.onboarding_configs;
  payment_email text;
begin
  select *
  into target_client
  from public.clients
  where id = public.resolve_public_client_id(p_slug)
  limit 1;

  if target_client.id is null then
    return null;
  end if;

  select *
  into target_config
  from public.onboarding_configs
  where client_id = target_client.id
  limit 1;

  select p.email
  into payment_email
  from public.profiles p
  where p.id = coalesce(target_client.seller_user_id, target_client.owner_user_id)
  limit 1;

  return jsonb_build_object(
    'client',
    jsonb_build_object(
      'id', target_client.id,
      'slug', target_client.slug,
      'name', target_client.name,
      'description', target_client.description,
      'seller_user_id', target_client.seller_user_id,
      'csm_user_id', target_client.csm_user_id
    ),
    'config',
    coalesce(
      to_jsonb(target_config),
      jsonb_build_object(
        'client_id', target_client.id,
        'start_date', current_date,
        'base_capacity', 80,
        'extra_capacity', 0,
        'lost_credits', 0,
        'custom_plan_credits', null,
        'custom_plan_price', null,
        'custom_plan_type', null,
        'custom_plan_billing_mode', 'subscription',
        'custom_plan_period_months', 1,
        'current_stage', 'cs',
        'credit_validity_days', 60,
        'show_all_completed', false,
        'sales_cleared', false,
        'created_at', timezone('utc', now()),
        'updated_at', timezone('utc', now()),
        'updated_by_user_id', null
      )
    ),
    'billing',
    public.get_client_billing_status(target_client.id),
    'catalog',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', item.id,
            'category', item.category,
            'label', item.label,
            'credits', item.credits,
            'sort_order', item.sort_order,
            'created_at', item.created_at,
            'updated_at', item.updated_at
          )
          order by item.category, item.sort_order, item.label
        )
        from public.credit_catalog_items item
        where item.is_active = true
      ),
      '[]'::jsonb
    ),
    'catalog_categories',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', category.id,
            'name', category.name,
            'description', category.description,
            'sort_order', category.sort_order,
            'is_active', category.is_active,
            'created_at', category.created_at,
            'updated_at', category.updated_at
          )
          order by category.sort_order, category.name
        )
        from public.credit_catalog_categories category
        where category.is_active = true
      ),
      '[]'::jsonb
    ),
    'payment_email',
    payment_email,
    'initiatives',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', i.id,
            'client_id', i.client_id,
            'title', i.title,
            'type', i.type,
            'labels', i.labels,
            'status', i.status,
            'description', i.description,
            'owner_client', i.owner_client,
            'owner_csm', i.owner_csm,
            'est_start_date', i.est_start_date,
            'est_end_date', i.est_end_date,
            'date_planned', i.date_planned,
            'last_activity', i.last_activity,
            'is_blocked', i.is_blocked,
            'sort_order', i.sort_order,
            'created_at', i.created_at,
            'updated_at', i.updated_at,
            'created_by_user_id', i.created_by_user_id,
            'updated_by_user_id', i.updated_by_user_id,
            'subitems',
            coalesce(
              (
                select jsonb_agg(
                  jsonb_build_object(
                    'id', s.id,
                    'initiative_id', s.initiative_id,
                    'catalog_item_id', s.catalog_item_id,
                    'name', s.name,
                    'status', s.status,
                    'target_date', s.target_date,
                    'unit_credits', s.unit_credits,
                    'quantity', s.quantity,
                    'sort_order', s.sort_order,
                    'created_at', s.created_at,
                    'updated_at', s.updated_at
                  )
                  order by s.sort_order
                )
                from public.onboarding_initiative_subitems s
                where s.initiative_id = i.id
              ),
              '[]'::jsonb
            ),
            'logs', '[]'::jsonb,
            'credits',
            coalesce(
              (
                select sum(s.unit_credits * s.quantity)
                from public.onboarding_initiative_subitems s
                where s.initiative_id = i.id
              ),
              0
            )
          )
          order by i.sort_order, i.created_at
        )
        from public.onboarding_initiatives i
        where i.client_id = target_client.id
      ),
      '[]'::jsonb
    )
  );
end;
$$;

drop function if exists public.create_public_backlog_initiative(text, text, text);
create or replace function public.create_public_backlog_initiative(
  p_slug text,
  p_title text,
  p_description text default null,
  p_catalog_item_ids uuid[] default null
)
returns public.onboarding_initiatives
language plpgsql
security definer
set search_path = public
as $$
declare
  target_client_id uuid;
  created_initiative public.onboarding_initiatives;
  next_sort_order integer;
  selected_item record;
  next_item_order integer := 0;
begin
  target_client_id := public.resolve_public_client_id(p_slug);

  if target_client_id is null then
    raise exception 'Client not found';
  end if;

  if nullif(trim(coalesce(p_title, '')), '') is null then
    raise exception 'Title is required';
  end if;

  if coalesce(array_length(p_catalog_item_ids, 1), 0) = 0 then
    raise exception 'At least one catalog item is required';
  end if;

  select coalesce(max(i.sort_order) + 1, 0)
  into next_sort_order
  from public.onboarding_initiatives i
  where i.client_id = target_client_id
    and i.status = 'backlog';

  insert into public.onboarding_initiatives (
    client_id,
    title,
    type,
    status,
    description,
    owner_client,
    owner_csm,
    est_start_date,
    est_end_date,
    date_planned,
    last_activity,
    is_blocked,
    sort_order,
    created_by_user_id,
    updated_by_user_id
  )
  values (
    target_client_id,
    trim(p_title),
    'Solicitud publica',
    'backlog',
    nullif(trim(coalesce(p_description, '')), ''),
    null,
    null,
    null,
    null,
    current_date,
    current_date,
    false,
    next_sort_order,
    null,
    null
  )
  returning *
  into created_initiative;

  for selected_item in
    select item.*
    from public.credit_catalog_items item
    where item.id = any(p_catalog_item_ids)
      and item.is_active = true
    order by item.category, item.sort_order, item.label
  loop
    insert into public.onboarding_initiative_subitems (
      initiative_id,
      catalog_item_id,
      name,
      status,
      target_date,
      unit_credits,
      quantity,
      sort_order
    )
    values (
      created_initiative.id,
      selected_item.id,
      selected_item.label,
      'pending',
      null,
      selected_item.credits,
      1,
      next_item_order
    );

    next_item_order := next_item_order + 1;
  end loop;

  insert into public.onboarding_activity_logs (
    initiative_id,
    entry,
    created_by_user_id
  )
  values (
    created_initiative.id,
    'Solicitud creada desde la vista publica.',
    null
  );

  return created_initiative;
end;
$$;

alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.client_members enable row level security;
alter table public.client_share_links enable row level security;
alter table public.credit_catalog_groups enable row level security;
alter table public.credit_catalog_group_categories enable row level security;
alter table public.credit_catalog_categories enable row level security;
alter table public.credit_catalog_items enable row level security;
alter table public.credit_catalog_group_items enable row level security;
alter table public.credit_catalog_group_category_links enable row level security;
alter table public.managed_prompts enable row level security;
alter table public.onboarding_configs enable row level security;
alter table public.client_billing_cycles enable row level security;
alter table public.client_credit_grants enable row level security;
alter table public.onboarding_initiatives enable row level security;
alter table public.onboarding_initiative_subitems enable row level security;
alter table public.onboarding_activity_logs enable row level security;
alter table public.sales_proposals enable row level security;
alter table public.sales_proposal_snapshots enable row level security;

drop policy if exists "profiles_select_allowed" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "clients_select_accessible" on public.clients;
drop policy if exists "clients_insert_owner" on public.clients;
drop policy if exists "clients_update_editors" on public.clients;
drop policy if exists "clients_delete_owner" on public.clients;
drop policy if exists "client_members_select_accessible" on public.client_members;
drop policy if exists "client_members_manage_owner" on public.client_members;
drop policy if exists "client_share_links_select_owner" on public.client_share_links;
drop policy if exists "client_share_links_manage_owner" on public.client_share_links;
drop policy if exists "catalog_groups_read_authenticated" on public.credit_catalog_groups;
drop policy if exists "catalog_groups_manage_authenticated" on public.credit_catalog_groups;
drop policy if exists "catalog_group_categories_read_authenticated" on public.credit_catalog_group_categories;
drop policy if exists "catalog_group_categories_manage_authenticated" on public.credit_catalog_group_categories;
drop policy if exists "catalog_categories_read_authenticated" on public.credit_catalog_categories;
drop policy if exists "catalog_categories_manage_authenticated" on public.credit_catalog_categories;
drop policy if exists "catalog_read_authenticated" on public.credit_catalog_items;
drop policy if exists "catalog_manage_authenticated" on public.credit_catalog_items;
drop policy if exists "catalog_group_items_read_authenticated" on public.credit_catalog_group_items;
drop policy if exists "catalog_group_items_manage_authenticated" on public.credit_catalog_group_items;
drop policy if exists "catalog_group_category_links_read_authenticated" on public.credit_catalog_group_category_links;
drop policy if exists "catalog_group_category_links_manage_authenticated" on public.credit_catalog_group_category_links;
drop policy if exists "managed_prompts_read_authenticated" on public.managed_prompts;
drop policy if exists "managed_prompts_manage_authenticated" on public.managed_prompts;
drop policy if exists "onboarding_configs_select_accessible" on public.onboarding_configs;
drop policy if exists "onboarding_configs_manage_editors" on public.onboarding_configs;
drop policy if exists "billing_cycles_select_accessible" on public.client_billing_cycles;
drop policy if exists "billing_cycles_manage_owner" on public.client_billing_cycles;
drop policy if exists "credit_grants_select_accessible" on public.client_credit_grants;
drop policy if exists "credit_grants_manage_owner" on public.client_credit_grants;
drop policy if exists "initiatives_select_accessible" on public.onboarding_initiatives;
drop policy if exists "initiatives_manage_editors" on public.onboarding_initiatives;
drop policy if exists "subitems_select_accessible" on public.onboarding_initiative_subitems;
drop policy if exists "subitems_manage_editors" on public.onboarding_initiative_subitems;
drop policy if exists "logs_select_accessible" on public.onboarding_activity_logs;
drop policy if exists "logs_manage_editors" on public.onboarding_activity_logs;

create policy "profiles_select_allowed"
on public.profiles
for select
to authenticated
using (public.can_view_profile(id));

create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy "clients_select_accessible"
on public.clients
for select
to authenticated
using (public.can_view_client(id));

create policy "clients_insert_owner"
on public.clients
for insert
to authenticated
with check (owner_user_id = auth.uid());

create policy "clients_update_editors"
on public.clients
for update
to authenticated
using (public.can_edit_client(id))
with check (public.can_edit_client(id));

create policy "clients_delete_owner"
on public.clients
for delete
to authenticated
using (public.current_client_role(id) = 'owner');

create policy "client_members_select_accessible"
on public.client_members
for select
to authenticated
using (public.can_view_client(client_id));

create policy "client_members_manage_owner"
on public.client_members
for all
to authenticated
using (public.current_client_role(client_id) = 'owner')
with check (public.current_client_role(client_id) = 'owner');

create policy "client_share_links_select_owner"
on public.client_share_links
for select
to authenticated
using (public.current_client_role(client_id) = 'owner');

create policy "client_share_links_manage_owner"
on public.client_share_links
for all
to authenticated
using (public.current_client_role(client_id) = 'owner')
with check (public.current_client_role(client_id) = 'owner');

create policy "catalog_groups_read_authenticated"
on public.credit_catalog_groups
for select
to authenticated
using (true);

create policy "catalog_groups_manage_authenticated"
on public.credit_catalog_groups
for all
to authenticated
using (true)
with check (true);

create policy "catalog_group_categories_read_authenticated"
on public.credit_catalog_group_categories
for select
to authenticated
using (true);

create policy "catalog_group_categories_manage_authenticated"
on public.credit_catalog_group_categories
for all
to authenticated
using (true)
with check (true);

create policy "catalog_categories_read_authenticated"
on public.credit_catalog_categories
for select
to authenticated
using (true);

create policy "catalog_categories_manage_authenticated"
on public.credit_catalog_categories
for all
to authenticated
using (true)
with check (true);

create policy "catalog_read_authenticated"
on public.credit_catalog_items
for select
to authenticated
using (true);

create policy "catalog_manage_authenticated"
on public.credit_catalog_items
for all
to authenticated
using (true)
with check (true);

create policy "catalog_group_items_read_authenticated"
on public.credit_catalog_group_items
for select
to authenticated
using (true);

create policy "catalog_group_items_manage_authenticated"
on public.credit_catalog_group_items
for all
to authenticated
using (true)
with check (true);

create policy "catalog_group_category_links_read_authenticated"
on public.credit_catalog_group_category_links
for select
to authenticated
using (true);

create policy "catalog_group_category_links_manage_authenticated"
on public.credit_catalog_group_category_links
for all
to authenticated
using (true)
with check (true);

create policy "managed_prompts_read_authenticated"
on public.managed_prompts
for select
to authenticated
using (true);

create policy "managed_prompts_manage_authenticated"
on public.managed_prompts
for all
to authenticated
using (true)
with check (true);

create policy "onboarding_configs_select_accessible"
on public.onboarding_configs
for select
to authenticated
using (public.can_view_client(client_id));

create policy "onboarding_configs_manage_editors"
on public.onboarding_configs
for all
to authenticated
using (public.can_edit_client(client_id))
with check (public.can_edit_client(client_id));

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

create policy "initiatives_select_accessible"
on public.onboarding_initiatives
for select
to authenticated
using (public.can_view_client(client_id));

create policy "initiatives_manage_editors"
on public.onboarding_initiatives
for all
to authenticated
using (public.can_edit_client(client_id))
with check (public.can_edit_client(client_id));

create policy "subitems_select_accessible"
on public.onboarding_initiative_subitems
for select
to authenticated
using (
  exists (
    select 1
    from public.onboarding_initiatives i
    where i.id = initiative_id
      and public.can_view_client(i.client_id)
  )
);

create policy "subitems_manage_editors"
on public.onboarding_initiative_subitems
for all
to authenticated
using (
  exists (
    select 1
    from public.onboarding_initiatives i
    where i.id = initiative_id
      and public.can_edit_client(i.client_id)
  )
)
with check (
  exists (
    select 1
    from public.onboarding_initiatives i
    where i.id = initiative_id
      and public.can_edit_client(i.client_id)
  )
);

create policy "logs_select_accessible"
on public.onboarding_activity_logs
for select
to authenticated
using (
  exists (
    select 1
    from public.onboarding_initiatives i
    where i.id = initiative_id
      and public.can_view_client(i.client_id)
  )
);

create policy "logs_manage_editors"
on public.onboarding_activity_logs
for all
to authenticated
using (
  exists (
    select 1
    from public.onboarding_initiatives i
    where i.id = initiative_id
      and public.can_edit_client(i.client_id)
  )
)
with check (
  exists (
    select 1
    from public.onboarding_initiatives i
    where i.id = initiative_id
      and public.can_edit_client(i.client_id)
  )
);

grant execute on function public.current_client_role(uuid) to authenticated;
grant execute on function public.can_view_client(uuid) to authenticated;
grant execute on function public.can_edit_client(uuid) to authenticated;
grant execute on function public.can_view_profile(uuid) to authenticated;
grant execute on function public.redeem_client_share_link(text) to authenticated;
grant execute on function public.create_client(text, text, text, uuid, uuid) to authenticated;
grant execute on function public.add_client_member_by_email(uuid, text, public.client_access_role, public.client_profile_role) to authenticated;
grant execute on function public.list_assignable_profiles() to authenticated;
grant execute on function public.get_client_cycle_window(uuid, date) to authenticated;
grant execute on function public.expire_unused_client_credits(uuid) to authenticated;
grant execute on function public.get_client_billing_status(uuid) to authenticated, service_role;
revoke execute on function public.record_stripe_checkout_payment(uuid, text, text, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.record_stripe_checkout_payment(uuid, text, text, integer, text, text, text) to service_role;
grant execute on function public.get_public_onboarding_snapshot(text) to anon, authenticated;
grant execute on function public.create_public_backlog_initiative(text, text, text, uuid[]) to anon, authenticated;

insert into public.credit_catalog_items (category, label, credits, sort_order)
values
  ('Diagnostico y Analisis', 'Sesiones de Mapeo del Proceso de Marketing', 9, 10),
  ('Diagnostico y Analisis', 'Auditoria de Madurez de Datos e IA', 3, 20),
  ('Diagnostico y Analisis', 'Sesion de Analisis de Friccion en el Funnel de Marketing', 13, 30),
  ('Diagnostico y Analisis', 'Informe de Diagnostico Ejecutivo', 6, 40),
  ('Diagnostico y Analisis', 'Definicion de RoadMap', 12, 50),
  ('Diagnostico y Analisis', 'Sesion de seguimiento de RoadMap', 6, 60),
  ('Implementacion y Configuracion', 'Sesiones de Diseno de Implementacion Base', 6, 70),
  ('Implementacion y Configuracion', 'Sesiones de Arquitectura y Gobernanza Base', 6, 80),
  ('Implementacion y Configuracion', 'Sprint de implementacion del CRM', 9, 90),
  ('Implementacion y Configuracion', 'Sprint de Integridad de Datos', 3, 100),
  ('Implementacion y Configuracion', 'Habilitacion de AI Assistant (Breeze)', 12, 110),
  ('Implementacion y Configuracion', 'Sesion de Plan de Piloto', 6, 120),
  ('Integraciones y Datos', 'Mapeo de flujos de integracion', 12, 130),
  ('Integraciones y Datos', 'Modelado de Datos', 12, 140),
  ('Integraciones y Datos', 'Informe de flujos de integracion', 3, 150),
  ('Integraciones y Datos', 'Requerimientos tecnicos para desarrollo', 3, 160),
  ('Integraciones y Datos', 'Test de conexiones de integracion', 6, 170),
  ('Integraciones y Datos', 'Auditoria de registros iniciales (integracion)', 6, 180),
  ('Integraciones y Datos', 'Sesion de acompanamiento tecnico', 9, 190),
  ('Capacitacion y Adopcion', 'Sesion de Entrenamiento a coordinadores', 6, 200),
  ('Capacitacion y Adopcion', 'Sesion de entrenamiento con equipo operativo: Gestion de cambio', 9, 210),
  ('Capacitacion y Adopcion', 'Sesion Liderazgo: Gestion del cambio', 9, 220),
  ('Capacitacion y Adopcion', 'Sesion de Acompanamiento (Stand-ups)', 4, 230),
  ('Capacitacion y Adopcion', 'Informe sobre Monitoreo de Adopcion', 1, 240),
  ('Capacitacion y Adopcion', 'Informe de Resultados y Aprendizajes', 9, 250)
on conflict (label) do update
set category = excluded.category,
    credits = excluded.credits,
    sort_order = excluded.sort_order,
    is_active = true,
    updated_at = timezone('utc', now());

insert into public.credit_catalog_group_categories (name, sort_order, is_active)
values
  ('Fundamentales', 0, true),
  ('Sales', 1, true),
  ('Marketing', 2, true),
  ('Service', 3, true),
  ('IA', 4, true),
  ('Content', 5, true)
on conflict (name) do update
set sort_order = excluded.sort_order,
    is_active = true,
    updated_at = timezone('utc', now());

insert into public.credit_catalog_categories (name, sort_order, is_active)
select
  category,
  row_number() over (order by min(sort_order), category) - 1,
  true
from public.credit_catalog_items
where nullif(trim(category), '') is not null
group by category
on conflict (name) do update
set sort_order = excluded.sort_order,
    is_active = true,
    updated_at = timezone('utc', now());

update public.credit_catalog_groups as groups
set
  modal_category_id = categories.id,
  modal_category = categories.name,
  updated_at = timezone('utc', now())
from public.credit_catalog_group_categories as categories
where nullif(trim(groups.modal_category), '') is not null
  and (
    case
      when lower(trim(groups.modal_category)) in ('fundamentos', 'fundamentales') then 'fundamentales'
      else lower(trim(groups.modal_category))
    end
  ) = lower(categories.name)
  and groups.modal_category_id is distinct from categories.id;

insert into public.credit_catalog_group_category_links (group_id, category_id)
select groups.id, groups.modal_category_id
from public.credit_catalog_groups as groups
where groups.modal_category_id is not null
on conflict (group_id, category_id) do nothing;
