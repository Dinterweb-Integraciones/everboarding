create table if not exists public.credit_catalog_use_case_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop index if exists public.credit_catalog_use_case_categories_sort_idx;

alter table public.credit_catalog_use_case_categories
drop column if exists sort_order;

create index if not exists credit_catalog_use_case_categories_name_idx
on public.credit_catalog_use_case_categories (name);

drop trigger if exists set_credit_catalog_use_case_categories_updated_at
on public.credit_catalog_use_case_categories;
create trigger set_credit_catalog_use_case_categories_updated_at
before update on public.credit_catalog_use_case_categories
for each row execute procedure public.set_current_timestamp_updated_at();

alter table public.credit_catalog_groups
add column if not exists use_case_category_id uuid
references public.credit_catalog_use_case_categories(id) on delete set null;

create index if not exists credit_catalog_groups_use_case_category_idx
on public.credit_catalog_groups (use_case_category_id);

alter table public.credit_catalog_use_case_categories enable row level security;

drop policy if exists "catalog_use_case_categories_read_authenticated"
on public.credit_catalog_use_case_categories;
drop policy if exists "catalog_use_case_categories_manage_authenticated"
on public.credit_catalog_use_case_categories;

create policy "catalog_use_case_categories_read_authenticated"
on public.credit_catalog_use_case_categories
for select
to authenticated
using (true);

create policy "catalog_use_case_categories_manage_authenticated"
on public.credit_catalog_use_case_categories
for all
to authenticated
using (true)
with check (true);
