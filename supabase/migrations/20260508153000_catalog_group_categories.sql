create table if not exists public.credit_catalog_group_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists credit_catalog_group_categories_sort_idx
on public.credit_catalog_group_categories (sort_order, name);

drop trigger if exists set_credit_catalog_group_categories_updated_at on public.credit_catalog_group_categories;
create trigger set_credit_catalog_group_categories_updated_at
before update on public.credit_catalog_group_categories
for each row execute procedure public.set_current_timestamp_updated_at();

alter table public.credit_catalog_groups
add column if not exists modal_category_id uuid references public.credit_catalog_group_categories(id) on delete set null;

with desired_categories(name, sort_order) as (
  values
    ('Fundamentales', 0),
    ('Sales', 1),
    ('Marketing', 2),
    ('Service', 3),
    ('IA', 4),
    ('Content', 5)
)
insert into public.credit_catalog_group_categories (name, sort_order, is_active)
select name, sort_order, true
from desired_categories
on conflict (name) do update
set sort_order = excluded.sort_order,
    is_active = true,
    updated_at = timezone('utc', now());

with normalized_existing as (
  select distinct
    case
      when lower(trim(modal_category)) in ('fundamentos', 'fundamentales') then 'Fundamentales'
      else trim(modal_category)
    end as name
  from public.credit_catalog_groups
  where nullif(trim(modal_category), '') is not null
),
unknown_categories as (
  select existing.name
  from normalized_existing as existing
  left join public.credit_catalog_group_categories as categories
    on lower(categories.name) = lower(existing.name)
  where categories.id is null
),
ordered_unknown_categories as (
  select
    name,
    row_number() over (order by name) + (
      select coalesce(max(sort_order), -1)
      from public.credit_catalog_group_categories
    ) as sort_order
  from unknown_categories
)
insert into public.credit_catalog_group_categories (name, sort_order, is_active)
select name, sort_order, true
from ordered_unknown_categories
on conflict (name) do nothing;

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

alter table public.credit_catalog_group_categories enable row level security;

drop policy if exists "catalog_group_categories_read_authenticated" on public.credit_catalog_group_categories;
drop policy if exists "catalog_group_categories_manage_authenticated" on public.credit_catalog_group_categories;

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
