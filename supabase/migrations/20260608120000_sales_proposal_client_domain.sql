alter table public.sales_proposals
add column if not exists client_domain text;
