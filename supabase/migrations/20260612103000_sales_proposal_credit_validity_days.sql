alter table public.sales_proposals
add column if not exists credit_validity_days integer not null default 60
check (credit_validity_days > 0);

update public.sales_proposals
set credit_validity_days = 90
where billing_mode = 'one_time'
  and credit_validity_days < 90;

update public.sales_proposals
set snapshot = jsonb_set(
  snapshot,
  '{cv}',
  to_jsonb(credit_validity_days),
  true
)
where snapshot is not null;

update public.sales_proposal_snapshots snapshots
set snapshot = jsonb_set(
  snapshots.snapshot,
  '{cv}',
  to_jsonb(proposals.credit_validity_days),
  true
)
from public.sales_proposals proposals
where snapshots.proposal_id = proposals.id
  and snapshots.snapshot is not null;
