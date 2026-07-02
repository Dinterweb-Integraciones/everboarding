alter table public.clients
add column if not exists is_active boolean not null default true;

create index if not exists clients_is_active_updated_at_idx
on public.clients (is_active, updated_at desc);
