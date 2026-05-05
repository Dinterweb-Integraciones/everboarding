alter table public.credit_catalog_groups
add column if not exists credits integer not null default 0
check (credits >= 0);
