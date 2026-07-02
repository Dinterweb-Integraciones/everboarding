alter table public.onboarding_north_star_history
add column if not exists north_star_lifecycle_status text not null default 'inactive'
  check (north_star_lifecycle_status in ('active', 'inactive', 'fulfilled'));

with latest_history as (
  select distinct on (history.client_id)
    history.id,
    config.north_star_lifecycle_status
  from public.onboarding_north_star_history history
  join public.onboarding_configs config
    on config.client_id = history.client_id
  where nullif(btrim(coalesce(history.north_star_text, '')), '') is not null
  order by history.client_id, history.created_at desc
)
update public.onboarding_north_star_history history
set north_star_lifecycle_status = latest_history.north_star_lifecycle_status
from latest_history
where history.id = latest_history.id;

create or replace function public.log_north_star_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(btrim(coalesce(new.north_star_text, '')), '') is not null
     and (
       tg_op = 'INSERT'
       or coalesce(old.north_star_text, '') is distinct from coalesce(new.north_star_text, '')
     ) then
    if coalesce(new.north_star_lifecycle_status, 'inactive') = 'active' then
      update public.onboarding_north_star_history
      set north_star_lifecycle_status = 'inactive'
      where client_id = new.client_id
        and north_star_lifecycle_status = 'active';
    end if;

    insert into public.onboarding_north_star_history (
      client_id,
      north_star_text,
      north_star_status,
      north_star_lifecycle_status,
      created_by_user_id
    )
    values (
      new.client_id,
      btrim(new.north_star_text),
      new.north_star_status,
      coalesce(new.north_star_lifecycle_status, 'inactive'),
      new.north_star_updated_by_user_id
    );
  end if;

  return new;
end;
$$;
