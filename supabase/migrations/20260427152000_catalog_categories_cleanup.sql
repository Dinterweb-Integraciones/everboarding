create table if not exists public.credit_catalog_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists credit_catalog_categories_sort_idx
on public.credit_catalog_categories (sort_order, name);

drop trigger if exists set_credit_catalog_categories_updated_at on public.credit_catalog_categories;
create trigger set_credit_catalog_categories_updated_at
before update on public.credit_catalog_categories
for each row execute procedure public.set_current_timestamp_updated_at();

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

alter table public.credit_catalog_categories enable row level security;

drop policy if exists "catalog_categories_read_authenticated" on public.credit_catalog_categories;
drop policy if exists "catalog_categories_manage_authenticated" on public.credit_catalog_categories;

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

with legacy_groups as (
  select grp.id
  from public.credit_catalog_groups as grp
  join public.credit_catalog_group_items as membership
    on membership.group_id = grp.id
  join public.credit_catalog_items as item
    on item.id = membership.catalog_item_id
  where grp.created_by_user_id is null
    and coalesce(grp.description, '') = ''
  group by grp.id, grp.name
  having bool_and(item.category = grp.name)
     and count(*) = (
       select count(*)
       from public.credit_catalog_items as grouped_item
       where grouped_item.category = grp.name
     )
)
delete from public.credit_catalog_group_items
where group_id in (select id from legacy_groups);

with legacy_groups as (
  select grp.id
  from public.credit_catalog_groups as grp
  where grp.created_by_user_id is null
    and coalesce(grp.description, '') = ''
    and not exists (
      select 1
      from public.credit_catalog_group_items as membership
      where membership.group_id = grp.id
    )
)
delete from public.credit_catalog_groups
where id in (select id from legacy_groups);
