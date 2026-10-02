-- Marca en el cliente el momento en que su paquete de créditos entra en la ventana de aviso
-- ("Paquete por vencer" de la vista pública): planes one_time a 8 días o menos del vencimiento.
-- Un job diario de pg_cron llena la fecha al entrar en la ventana y la limpia al salir de ella
-- (recarga de paquete o vencimiento).
alter table public.clients
add column if not exists package_expiration_warning_at timestamptz;

-- El job no debe mover clients.updated_at: los listados ordenan por esa columna.
create or replace function public.set_clients_updated_at()
returns trigger
language plpgsql
as $$
begin
  if (to_jsonb(new) - 'package_expiration_warning_at' - 'updated_at')
     = (to_jsonb(old) - 'package_expiration_warning_at' - 'updated_at') then
    new.updated_at = old.updated_at;
  else
    new.updated_at = timezone('utc', now());
  end if;
  return new;
end;
$$;

drop trigger if exists set_clients_updated_at on public.clients;
create trigger set_clients_updated_at
before update on public.clients
for each row execute procedure public.set_clients_updated_at();

-- Misma regla que isPackageExpirationWarningActive en public-onboarding-page.tsx:
-- los créditos valen todo el día de expires_at, y el aviso cubre los 8 días previos al cierre,
-- es decir, expires_at entre hoy y hoy + 7 (hora de Nicaragua).
create or replace function public.mark_package_expiration_warnings()
returns void
language plpgsql
as $$
declare
  v_today date := (now() at time zone 'America/Managua')::date;
begin
  with client_state as (
    select
      c.id,
      coalesce(
        oc.custom_plan_billing_mode = 'one_time'
        and latest_grant.expires_at between v_today and v_today + 7,
        false
      ) as in_warning_window
    from public.clients c
    left join public.onboarding_configs oc on oc.client_id = c.id
    left join lateral (
      select max(g.expires_at) as expires_at
      from public.client_credit_grants g
      where g.client_id = c.id
    ) latest_grant on true
  )
  update public.clients c
  set package_expiration_warning_at =
    case when s.in_warning_window then timezone('utc', now()) else null end
  from client_state s
  where s.id = c.id
    and (
      (s.in_warning_window and c.package_expiration_warning_at is null)
      or (not s.in_warning_window and c.package_expiration_warning_at is not null)
    );
end;
$$;

revoke execute on function public.mark_package_expiration_warnings() from public, anon, authenticated;

create extension if not exists pg_cron;

-- 06:05 UTC = 00:05 en Nicaragua (UTC-6, sin horario de verano).
select cron.schedule(
  'mark-package-expiration-warnings',
  '5 6 * * *',
  $$select public.mark_package_expiration_warnings();$$
);

-- Llenado inicial para los clientes que ya están dentro de la ventana.
select public.mark_package_expiration_warnings();
