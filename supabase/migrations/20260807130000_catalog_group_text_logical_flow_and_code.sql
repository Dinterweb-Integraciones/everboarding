alter table public.credit_catalog_groups
add column if not exists use_case_code text,
add column if not exists next_logical_use_cases text,
add column if not exists previous_use_cases text,
add column if not exists subsequent_use_cases text;

update public.credit_catalog_groups as groups
set next_logical_use_cases = related.name
from public.credit_catalog_groups as related
where groups.next_use_case_id = related.id
  and nullif(trim(coalesce(groups.next_logical_use_cases, '')), '') is null;

update public.credit_catalog_groups as groups
set previous_use_cases = previous_names.names
from (
  select
    links.group_id,
    string_agg(previous_groups.name, '; ' order by previous_groups.name) as names
  from public.credit_catalog_group_previous_cases as links
  join public.credit_catalog_groups as previous_groups
    on previous_groups.id = links.previous_group_id
  group by links.group_id
) as previous_names
where groups.id = previous_names.group_id
  and nullif(trim(coalesce(groups.previous_use_cases, '')), '') is null;

drop table if exists public.credit_catalog_group_previous_cases;

alter table public.credit_catalog_groups
drop constraint if exists credit_catalog_groups_next_use_case_not_self;

drop index if exists public.credit_catalog_groups_next_use_case_idx;

alter table public.credit_catalog_groups
drop column if exists next_use_case_id;

create unique index if not exists credit_catalog_groups_use_case_code_unique_idx
on public.credit_catalog_groups (lower(trim(use_case_code)))
where nullif(trim(use_case_code), '') is not null;
