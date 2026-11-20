-- Enlaces para vendedores externos: cada lista de precios puede tener uno o varios enlaces con un
-- token secreto. Quien abre el enlace cotiza sin iniciar sesión, con la tarifa de la lista fija
-- (paquete, moneda y créditos). Desactivar o eliminar el enlace corta el acceso.
create table if not exists public.price_list_links (
  id uuid primary key default gen_random_uuid(),
  price_list_id uuid not null references public.price_lists(id) on delete cascade,
  token text not null,
  label text,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists price_list_links_token_unique_idx on public.price_list_links (token);
create index if not exists price_list_links_price_list_idx on public.price_list_links (price_list_id, created_at);

drop trigger if exists set_price_list_links_updated_at on public.price_list_links;
create trigger set_price_list_links_updated_at
before update on public.price_list_links
for each row execute procedure public.set_current_timestamp_updated_at();

-- Solo se lee y escribe desde el servidor con la service role.
alter table public.price_list_links enable row level security;

-- Propuestas creadas desde un enlace externo: el enlace solo puede guardar sus propias propuestas.
alter table public.sales_proposals
add column if not exists price_list_link_id uuid references public.price_list_links(id) on delete set null;

create index if not exists sales_proposals_price_list_link_id_idx on public.sales_proposals (price_list_link_id);
