-- Observaciones internas de Customer Success sobre el cliente (una por cliente).
-- La app solo las envía al navegador de CS, admin y superadmin.
alter table public.clients
add column if not exists observations text;
