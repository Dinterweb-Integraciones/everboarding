alter table if exists public.sales_coupons
add column if not exists granted_credits integer not null default 40 check (granted_credits >= 0),
add column if not exists discounted_price numeric(10, 2) not null default 0 check (discounted_price >= 0);
