-- Casos de uso disponibles solo para clientes con recurrencia (plan Everboarding). Los clientes de
-- paquetes los ven en gris en el catálogo y no pueden agregarlos.
alter table public.credit_catalog_groups
add column if not exists requires_subscription boolean not null default false;
