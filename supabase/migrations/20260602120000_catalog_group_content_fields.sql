alter table public.credit_catalog_groups
add column if not exists preview text,
add column if not exists completion_outcome text,
add column if not exists success_milestone text;
