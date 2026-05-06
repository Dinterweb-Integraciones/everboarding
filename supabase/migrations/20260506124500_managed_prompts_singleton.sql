alter table public.managed_prompts
add column if not exists singleton_key text;

with ranked_prompts as (
  select
    id,
    row_number() over (
      order by updated_at desc, created_at desc, id desc
    ) as row_number
  from public.managed_prompts
)
delete from public.managed_prompts
where id in (
  select id
  from ranked_prompts
  where row_number > 1
);

update public.managed_prompts
set singleton_key = 'default'
where singleton_key is null
   or singleton_key <> 'default';

alter table public.managed_prompts
alter column singleton_key set default 'default';

alter table public.managed_prompts
alter column singleton_key set not null;

create unique index if not exists managed_prompts_singleton_key_idx
on public.managed_prompts (singleton_key);
