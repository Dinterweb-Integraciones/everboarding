alter table public.sales_proposals
add column if not exists transfer_bank text;

alter table public.client_billing_cycles
add column if not exists transfer_bank text;
