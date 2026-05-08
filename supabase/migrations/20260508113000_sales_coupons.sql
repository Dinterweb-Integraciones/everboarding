create table if not exists public.sales_coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  is_active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.sales_proposals
add column if not exists applied_coupon_id uuid references public.sales_coupons(id) on delete set null,
add column if not exists applied_coupon_code text,
add column if not exists coupon_applied_at timestamptz;

create unique index if not exists sales_coupons_code_unique_idx on public.sales_coupons (lower(code));
create index if not exists sales_coupons_active_idx on public.sales_coupons (is_active, starts_at, ends_at);

drop trigger if exists set_sales_coupons_updated_at on public.sales_coupons;
create trigger set_sales_coupons_updated_at
before update on public.sales_coupons
for each row execute procedure public.set_current_timestamp_updated_at();
