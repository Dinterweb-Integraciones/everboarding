alter table if exists public.sales_coupons
add column if not exists coupon_type text not null default 'package_override'
  check (coupon_type in ('package_override', 'percentage')),
add column if not exists percentage_off numeric(5, 2)
  check (percentage_off is null or (percentage_off > 0 and percentage_off <= 100));

update public.sales_coupons
set coupon_type = 'package_override'
where coupon_type is null;
