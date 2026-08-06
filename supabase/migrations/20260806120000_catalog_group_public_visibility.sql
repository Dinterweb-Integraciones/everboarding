alter table public.credit_catalog_groups
add column if not exists is_public boolean not null default true;

create index if not exists credit_catalog_groups_public_active_sort_idx
on public.credit_catalog_groups (is_public, is_active, sort_order, name);
