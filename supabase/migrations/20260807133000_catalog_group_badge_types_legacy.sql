alter table public.credit_catalog_group_badge_types
add column if not exists is_legacy boolean not null default false;

-- Conserva las keywords existentes únicamente como referencia histórica.
update public.credit_catalog_group_badge_types
set is_legacy = true;

create index if not exists credit_catalog_group_badge_types_available_idx
on public.credit_catalog_group_badge_types (is_legacy, is_active, sort_order, label);
