alter table if exists public.sales_coupons
drop column if exists granted_credits,
drop column if exists quoted_price,
drop column if exists currency,
drop column if exists billing_mode,
drop column if exists plan_period_months;
