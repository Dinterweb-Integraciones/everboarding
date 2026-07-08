alter table public.onboarding_initiatives
add column if not exists north_star_history_id uuid references public.onboarding_north_star_history(id) on delete set null;

create index if not exists onboarding_initiatives_north_star_history_idx
on public.onboarding_initiatives (north_star_history_id);

create or replace function public.assign_active_north_star_to_completed_initiative()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'completed'
     and new.north_star_history_id is null
     and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    select history.id
    into new.north_star_history_id
    from public.onboarding_north_star_history history
    where history.client_id = new.client_id
      and history.north_star_lifecycle_status = 'active'
    order by history.created_at desc
    limit 1;
  end if;

  return new;
end;
$$;

drop trigger if exists assign_active_north_star_to_completed_initiative_on_write on public.onboarding_initiatives;
create trigger assign_active_north_star_to_completed_initiative_on_write
before insert or update of status on public.onboarding_initiatives
for each row execute procedure public.assign_active_north_star_to_completed_initiative();
