create extension if not exists pgcrypto;

create type public.client_access_role as enum ('viewer', 'editor', 'owner');
create type public.client_profile_role as enum ('sales', 'csm', 'client', 'stakeholder');
create type public.initiative_status as enum ('backlog', 'planned', 'executing', 'completed');
create type public.custom_plan_type as enum ('mensual', 'proyecto');
create type public.project_stage as enum ('sales', 'cs', 'client');

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

create table if not exists public.onboarding_configs (
  client_id uuid primary key references public.clients(id) on delete cascade,
  start_date date not null default current_date,
  base_capacity integer not null default 80 check (base_capacity >= 0),
  extra_capacity integer not null default 0 check (extra_capacity >= 0),
  lost_credits integer not null default 0 check (lost_credits >= 0),
  custom_plan_credits integer check (custom_plan_credits is null or custom_plan_credits >= 0),
  custom_plan_price numeric(10, 2) check (custom_plan_price is null or custom_plan_price >= 0),
  custom_plan_type public.custom_plan_type,
  current_stage public.project_stage not null default 'cs',
  credit_validity_days integer not null default 60 check (credit_validity_days > 0),
  show_all_completed boolean not null default false,
  sales_cleared boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by_user_id uuid references auth.users(id) on delete set null
);

create table if not exists public.onboarding_initiatives (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  title text not null,
  type text,
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
  unit_credits integer not null check (unit_credits >= 0),
  quantity integer not null default 1 check (quantity > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

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
create index if not exists onboarding_initiatives_client_status_idx on public.onboarding_initiatives (client_id, status, sort_order);
create index if not exists onboarding_subitems_initiative_id_idx on public.onboarding_initiative_subitems (initiative_id, sort_order);
create index if not exists onboarding_logs_initiative_id_idx on public.onboarding_activity_logs (initiative_id, created_at desc);

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute procedure public.set_current_timestamp_updated_at();

drop trigger if exists set_clients_updated_at on public.clients;
create trigger set_clients_updated_at
before update on public.clients
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

drop trigger if exists set_onboarding_configs_updated_at on public.onboarding_configs;
create trigger set_onboarding_configs_updated_at
before update on public.onboarding_configs
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
      'viewer',
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
stable
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
        'current_stage', 'cs',
        'credit_validity_days', 60,
        'show_all_completed', false,
        'sales_cleared', false,
        'created_at', timezone('utc', now()),
        'updated_at', timezone('utc', now()),
        'updated_by_user_id', null
      )
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

create or replace function public.create_public_backlog_initiative(
  p_slug text,
  p_title text,
  p_description text default null
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
begin
  target_client_id := public.resolve_public_client_id(p_slug);

  if target_client_id is null then
    raise exception 'Client not found';
  end if;

  if nullif(trim(coalesce(p_title, '')), '') is null then
    raise exception 'Title is required';
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
alter table public.credit_catalog_items enable row level security;
alter table public.onboarding_configs enable row level security;
alter table public.onboarding_initiatives enable row level security;
alter table public.onboarding_initiative_subitems enable row level security;
alter table public.onboarding_activity_logs enable row level security;

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
drop policy if exists "catalog_read_authenticated" on public.credit_catalog_items;
drop policy if exists "onboarding_configs_select_accessible" on public.onboarding_configs;
drop policy if exists "onboarding_configs_manage_editors" on public.onboarding_configs;
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

create policy "catalog_read_authenticated"
on public.credit_catalog_items
for select
to authenticated
using (true);

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
grant execute on function public.get_public_onboarding_snapshot(text) to anon, authenticated;
grant execute on function public.create_public_backlog_initiative(text, text, text) to anon, authenticated;

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
