-- Todos los clientes consumen créditos del paquete vigente el día en que comprometen cada caso
-- (ver 20261020120000_credit_allocation_by_commit_date). Con el reparto anterior, cualquier
-- paquete vencido con saldo sin usar seguía absorbiendo los casos nuevos y los disponibles no
-- bajaban. Los clientes nuevos también lo usan por defecto.

alter table public.onboarding_configs
alter column credit_allocation_by_commit_date set default true;

-- Activar la marca no debe tocar updated_at de las configuraciones.
alter table public.onboarding_configs disable trigger set_onboarding_configs_updated_at;

update public.onboarding_configs
set credit_allocation_by_commit_date = true
where not credit_allocation_by_commit_date;

alter table public.onboarding_configs enable trigger set_onboarding_configs_updated_at;

-- Recalcula el saldo de los clientes activos. Los inactivos se recalculan, como siempre, la
-- próxima vez que se consulte su estado de cobro.
do $$
declare
  client_record record;
begin
  for client_record in
    select distinct g.client_id
    from public.client_credit_grants g
    join public.clients c on c.id = g.client_id
    where c.is_active
  loop
    perform public.expire_unused_client_credits(client_record.client_id);
  end loop;
end;
$$;
