alter table public.credit_catalog_groups
add column if not exists cluster text,
add column if not exists next_use_case_id uuid
references public.credit_catalog_groups(id) on delete set null;

alter table public.credit_catalog_groups
drop constraint if exists credit_catalog_groups_next_use_case_not_self;
alter table public.credit_catalog_groups
add constraint credit_catalog_groups_next_use_case_not_self
check (next_use_case_id is distinct from id);

create index if not exists credit_catalog_groups_cluster_idx
on public.credit_catalog_groups (cluster);

create index if not exists credit_catalog_groups_next_use_case_idx
on public.credit_catalog_groups (next_use_case_id);

create table if not exists public.credit_catalog_group_previous_cases (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.credit_catalog_groups(id) on delete cascade,
  previous_group_id uuid not null references public.credit_catalog_groups(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  unique (group_id, previous_group_id),
  check (group_id <> previous_group_id)
);

create index if not exists credit_catalog_group_previous_cases_group_idx
on public.credit_catalog_group_previous_cases (group_id);

create index if not exists credit_catalog_group_previous_cases_previous_idx
on public.credit_catalog_group_previous_cases (previous_group_id);

alter table public.credit_catalog_group_previous_cases enable row level security;

drop policy if exists "catalog_group_previous_cases_read_authenticated"
on public.credit_catalog_group_previous_cases;
drop policy if exists "catalog_group_previous_cases_manage_authenticated"
on public.credit_catalog_group_previous_cases;

create policy "catalog_group_previous_cases_read_authenticated"
on public.credit_catalog_group_previous_cases
for select
to authenticated
using (true);

create policy "catalog_group_previous_cases_manage_authenticated"
on public.credit_catalog_group_previous_cases
for all
to authenticated
using (true)
with check (true);
