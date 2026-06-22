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
        and lower(trim(i.title)) like '%kickoff%'
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
