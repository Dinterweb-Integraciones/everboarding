create table if not exists public.credit_catalog_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists credit_catalog_groups_sort_idx
on public.credit_catalog_groups (sort_order, name);

drop trigger if exists set_credit_catalog_groups_updated_at on public.credit_catalog_groups;
create trigger set_credit_catalog_groups_updated_at
before update on public.credit_catalog_groups
for each row execute procedure public.set_current_timestamp_updated_at();

alter table public.credit_catalog_groups enable row level security;

drop policy if exists "catalog_groups_read_authenticated" on public.credit_catalog_groups;
drop policy if exists "catalog_groups_manage_authenticated" on public.credit_catalog_groups;

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
