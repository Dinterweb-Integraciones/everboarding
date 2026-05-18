create table if not exists public.credit_catalog_group_category_links (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.credit_catalog_groups(id) on delete cascade,
  category_id uuid not null references public.credit_catalog_group_categories(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  unique (group_id, category_id)
);

create index if not exists credit_catalog_group_category_links_group_idx
on public.credit_catalog_group_category_links (group_id);

create index if not exists credit_catalog_group_category_links_category_idx
on public.credit_catalog_group_category_links (category_id);

insert into public.credit_catalog_group_category_links (group_id, category_id)
select groups.id, groups.modal_category_id
from public.credit_catalog_groups as groups
where groups.modal_category_id is not null
on conflict (group_id, category_id) do nothing;

alter table public.credit_catalog_group_category_links enable row level security;

drop policy if exists "catalog_group_category_links_read_authenticated" on public.credit_catalog_group_category_links;
drop policy if exists "catalog_group_category_links_manage_authenticated" on public.credit_catalog_group_category_links;

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
