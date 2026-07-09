alter table public.credit_catalog_groups
add column if not exists display_badge text;

create table if not exists public.credit_catalog_group_badge_types (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists credit_catalog_group_badge_types_sort_idx
on public.credit_catalog_group_badge_types (sort_order, label);

drop trigger if exists set_credit_catalog_group_badge_types_updated_at on public.credit_catalog_group_badge_types;
create trigger set_credit_catalog_group_badge_types_updated_at
before update on public.credit_catalog_group_badge_types
for each row execute function public.set_current_timestamp_updated_at();

alter table public.credit_catalog_group_badge_types enable row level security;

drop policy if exists "catalog_group_badge_types_read_authenticated" on public.credit_catalog_group_badge_types;
drop policy if exists "catalog_group_badge_types_manage_authenticated" on public.credit_catalog_group_badge_types;

create policy "catalog_group_badge_types_read_authenticated"
on public.credit_catalog_group_badge_types
for select
to authenticated
using (true);

create policy "catalog_group_badge_types_manage_authenticated"
on public.credit_catalog_group_badge_types
for all
to authenticated
using (true)
with check (true);
