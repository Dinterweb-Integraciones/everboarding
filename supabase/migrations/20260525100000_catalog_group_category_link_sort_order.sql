alter table public.credit_catalog_group_category_links
add column if not exists sort_order integer not null default 0;

with ranked_links as (
  select
    links.id,
    row_number() over (
      partition by links.category_id
      order by
        case when groups.priority_status = 'prioritario' then 0 else 1 end,
        groups.sort_order,
        groups.name,
        links.created_at,
        links.id
    ) - 1 as next_sort_order
  from public.credit_catalog_group_category_links as links
  join public.credit_catalog_groups as groups
    on groups.id = links.group_id
)
update public.credit_catalog_group_category_links as links
set sort_order = ranked_links.next_sort_order
from ranked_links
where ranked_links.id = links.id;

create index if not exists credit_catalog_group_category_links_category_sort_idx
on public.credit_catalog_group_category_links (category_id, sort_order, created_at);
