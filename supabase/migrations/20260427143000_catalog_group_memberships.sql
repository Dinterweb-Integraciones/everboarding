create table if not exists public.credit_catalog_group_items (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.credit_catalog_groups(id) on delete cascade,
  catalog_item_id uuid not null references public.credit_catalog_items(id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  unique (group_id, catalog_item_id)
);

create index if not exists credit_catalog_group_items_group_idx
on public.credit_catalog_group_items (group_id, sort_order);

create index if not exists credit_catalog_group_items_item_idx
on public.credit_catalog_group_items (catalog_item_id);

insert into public.credit_catalog_group_items (group_id, catalog_item_id, sort_order)
select
  item.group_id,
  item.id,
  row_number() over (
    partition by item.group_id
    order by item.sort_order, item.label
  ) - 1
from public.credit_catalog_items as item
where item.group_id is not null
on conflict (group_id, catalog_item_id) do nothing;

alter table public.credit_catalog_group_items enable row level security;

drop policy if exists "catalog_group_items_read_authenticated" on public.credit_catalog_group_items;
drop policy if exists "catalog_group_items_manage_authenticated" on public.credit_catalog_group_items;

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
