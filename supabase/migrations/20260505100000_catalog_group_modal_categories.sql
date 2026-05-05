alter table public.credit_catalog_groups
add column if not exists modal_category text;

update public.credit_catalog_groups
set modal_category = name
where modal_category is null
  and coalesce(name, '') <> '';
