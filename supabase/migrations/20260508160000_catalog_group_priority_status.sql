alter table public.credit_catalog_groups
add column if not exists priority_status text not null default 'normal'
check (priority_status in ('normal', 'prioritario'));

update public.credit_catalog_groups
set priority_status = 'normal'
where priority_status is null
   or priority_status not in ('normal', 'prioritario');
