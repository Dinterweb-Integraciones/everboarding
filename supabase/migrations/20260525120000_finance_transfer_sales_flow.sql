alter type public.platform_role add value if not exists 'finance';

alter type public.sales_proposal_status add value if not exists 'transfer_pending';

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typnamespace = 'public'::regnamespace
      and typname = 'sales_payment_method'
  ) then
    create type public.sales_payment_method as enum ('stripe', 'bank_transfer');
  end if;
end $$;

alter table public.sales_proposals
add column if not exists payment_method public.sales_payment_method not null default 'stripe',
add column if not exists transfer_reference text,
add column if not exists transfer_validated_at timestamptz,
add column if not exists transfer_validated_by_user_id uuid references auth.users(id) on delete set null;

update public.sales_proposals
set payment_method = 'stripe'
where payment_method is null;
