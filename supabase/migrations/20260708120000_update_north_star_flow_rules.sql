create or replace function public.enforce_north_star_for_kickoff_flow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_config public.onboarding_configs;
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
       and nullif(btrim(coalesce(target_config.north_star_text, '')), '') is null then
      raise exception 'Antes de completar Kickoff, redacta El Norte.';
    end if;

    if coalesce(target_config.north_star_required, false)
       and lower(trim(new.title)) not like '%kickoff%'
       and old.status = 'planned'
       and new.status in ('executing', 'completed')
       and coalesce(target_config.north_star_status, 'pending') not in ('client_approved', 'completed') then
      raise exception 'Para iniciar casos planificados, El Norte debe estar validado por el cliente.';
    end if;
  end if;

  return new;
end;
$$;
