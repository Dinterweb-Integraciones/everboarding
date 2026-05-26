alter table public.client_billing_cycles
add column if not exists sales_proposal_id uuid references public.sales_proposals(id) on delete set null,
add column if not exists payment_method public.sales_payment_method not null default 'stripe',
add column if not exists transfer_reference text,
add column if not exists transfer_validated_at timestamptz,
add column if not exists transfer_validated_by_user_id uuid references auth.users(id) on delete set null;

create index if not exists client_billing_cycles_transfer_status_idx
on public.client_billing_cycles (payment_method, status, cycle_start_date desc);

create index if not exists client_billing_cycles_sales_proposal_idx
on public.client_billing_cycles (sales_proposal_id, cycle_start_date desc);
