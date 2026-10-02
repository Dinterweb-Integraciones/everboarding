-- Publica en el canal de Postgres "package_expiration_warning" cuando el job diario llena
-- clients.package_expiration_warning_at (null -> fecha), para que el nodo Postgres Trigger de n8n
-- (Listen For: Listen to Channel) lo reciba. Se notifica una sola vez por ventana de aviso:
-- el job no vuelve a tocar la fecha mientras el cliente siga en ella, y limpiarla no notifica.
-- NOTIFY se entrega al hacer commit y solo a las sesiones que estén escuchando en ese momento.
create or replace function public.notify_package_expiration_warning()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'America/Managua')::date;
  v_expires_at date;
  v_payload jsonb;
begin
  select max(g.expires_at) into v_expires_at
  from public.client_credit_grants g
  where g.client_id = new.id;

  select jsonb_build_object(
    'client_id', new.id,
    'client_name', new.name,
    'client_slug', new.slug,
    'client_is_active', new.is_active,
    'package_expiration_warning_at', new.package_expiration_warning_at,
    'package_expires_at', v_expires_at,
    'days_remaining', case when v_expires_at is null then null else greatest(v_expires_at - v_today, 0) end,
    'csm_email', csm.email,
    'csm_name', csm.full_name,
    'seller_email', seller.email,
    'seller_name', seller.full_name,
    'hubspot_deal_id', (
      select sp.hubspot_deal_id
      from public.sales_proposals sp
      where sp.activated_client_id = new.id
        and sp.hubspot_deal_id is not null
      order by sp.created_at desc
      limit 1
    ),
    'sent_at', timezone('utc', now())
  )
  into v_payload
  from (select 1) as base
  left join public.profiles csm on csm.id = new.csm_user_id
  left join public.profiles seller on seller.id = new.seller_user_id;

  perform pg_notify('package_expiration_warning', v_payload::text);

  return new;
end;
$$;

revoke execute on function public.notify_package_expiration_warning() from public, anon, authenticated;

drop trigger if exists notify_package_expiration_warning on public.clients;
create trigger notify_package_expiration_warning
after update of package_expiration_warning_at on public.clients
for each row
when (old.package_expiration_warning_at is null and new.package_expiration_warning_at is not null)
execute function public.notify_package_expiration_warning();
