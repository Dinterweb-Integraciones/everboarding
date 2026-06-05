alter table public.onboarding_configs
add column if not exists north_star_required boolean not null default true,
add column if not exists north_star_text text,
add column if not exists north_star_status text not null default 'pending'
  check (north_star_status in ('pending', 'cs_preapproved', 'client_approved', 'completed')),
add column if not exists north_star_dismissals_used integer not null default 0
  check (north_star_dismissals_used >= 0 and north_star_dismissals_used <= 3),
add column if not exists north_star_cs_preapproved_at timestamptz,
add column if not exists north_star_client_approved_at timestamptz,
add column if not exists north_star_completed_at timestamptz,
add column if not exists north_star_updated_by_user_id uuid references auth.users(id) on delete set null;

update public.onboarding_configs
set north_star_required = false
where north_star_status = 'pending'
  and north_star_text is null
  and north_star_cs_preapproved_at is null
  and north_star_client_approved_at is null
  and north_star_completed_at is null;

create or replace function public.enforce_north_star_for_kickoff_flow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_config public.onboarding_configs;
  kickoff_completed boolean;
begin
  if tg_op = 'INSERT' or old.status is distinct from new.status then
    select *
    into target_config
    from public.onboarding_configs
    where client_id = new.client_id
    limit 1;

    if coalesce(target_config.north_star_required, false)
       and lower(trim(new.title)) like '%kickoff%'
       and new.status = 'completed'
       and coalesce(target_config.north_star_status, 'pending') <> 'completed' then
      raise exception 'Antes de completar Kickoff, El Norte debe estar aprobado por cliente y Customer Success';
    end if;

    select exists (
      select 1
      from public.onboarding_initiatives i
      where i.client_id = new.client_id
        and lower(trim(i.title)) = 'kickoff'
        and i.status = 'completed'
        and i.id <> new.id
    )
    into kickoff_completed;

    if coalesce(target_config.north_star_required, false)
       and lower(trim(new.title)) not like '%kickoff%'
       and old.status = 'planned'
       and new.status in ('executing', 'completed')
       and not kickoff_completed then
      raise exception 'Primero completa Kickoff con El Norte aprobado antes de iniciar o completar otros casos planificados';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_north_star_for_kickoff_flow_on_write on public.onboarding_initiatives;
create trigger enforce_north_star_for_kickoff_flow_on_write
before insert or update of status on public.onboarding_initiatives
for each row execute procedure public.enforce_north_star_for_kickoff_flow();
