-- Listas de precios por país o región. Cada lista ajusta cuántos créditos cuesta cada caso de uso
-- (aumento o descuento porcentual); el precio de los paquetes no cambia. El vendedor de Dinterweb
-- elige la lista en la propuesta (se congela en el snapshot de la propuesta) y, al activarse, el
-- cliente la hereda: sus casos de uso se le siguen cotizando con ella.
create table if not exists public.price_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  countries text[] not null default '{}',
  adjustment_type text not null check (adjustment_type in ('increase', 'discount')),
  percentage numeric(6, 2) not null check (percentage > 0 and percentage <= 100),
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  -- Un descuento del 100% dejaría los casos de uso en cero créditos.
  constraint price_lists_discount_below_100 check (adjustment_type <> 'discount' or percentage < 100)
);

create unique index if not exists price_lists_name_unique_idx on public.price_lists (lower(name));
create index if not exists price_lists_active_idx on public.price_lists (is_active, name);

drop trigger if exists set_price_lists_updated_at on public.price_lists;
create trigger set_price_lists_updated_at
before update on public.price_lists
for each row execute procedure public.set_current_timestamp_updated_at();

-- Solo se lee y escribe desde el servidor con la service role.
alter table public.price_lists enable row level security;

alter table public.clients
add column if not exists price_list_id uuid references public.price_lists(id) on delete set null;

create index if not exists clients_price_list_id_idx on public.clients (price_list_id);
