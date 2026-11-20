-- Cada lista de precios define además el paquete que se vende con ella: créditos, precio base y
-- moneda. El vendedor de Dinterweb arranca la propuesta con ese paquete y el cliente que hereda la
-- lista amplía con él y paga en esa moneda. Las listas existentes quedan con el paquete por defecto
-- (80 CR por USD 1197).
alter table public.price_lists
  add column if not exists package_credits integer not null default 80,
  add column if not exists package_price numeric(12, 2) not null default 1197,
  add column if not exists currency text not null default 'usd';

alter table public.price_lists
  drop constraint if exists price_lists_package_credits_positive,
  add constraint price_lists_package_credits_positive check (package_credits > 0);

alter table public.price_lists
  drop constraint if exists price_lists_package_price_positive,
  add constraint price_lists_package_price_positive check (package_price > 0);

alter table public.price_lists
  drop constraint if exists price_lists_currency_format,
  add constraint price_lists_currency_format check (currency ~ '^[a-z]{3}$');

-- Una lista puede no ajustar los créditos (0%) y solo definir paquete y moneda.
alter table public.price_lists drop constraint if exists price_lists_percentage_check;
alter table public.price_lists
  add constraint price_lists_percentage_check check (percentage >= 0 and percentage <= 100);
