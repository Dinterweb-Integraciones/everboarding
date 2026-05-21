create table if not exists public.sales_proposal_snapshots (
  proposal_id uuid primary key references public.sales_proposals(id) on delete cascade,
  snapshot jsonb not null default '{"i":[]}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists set_sales_proposal_snapshots_updated_at on public.sales_proposal_snapshots;
create trigger set_sales_proposal_snapshots_updated_at
before update on public.sales_proposal_snapshots
for each row execute procedure public.set_current_timestamp_updated_at();

insert into public.sales_proposal_snapshots (proposal_id, snapshot)
select id, snapshot
from public.sales_proposals
on conflict (proposal_id) do update
set snapshot = excluded.snapshot,
    updated_at = timezone('utc', now());

update public.sales_proposals
set snapshot = jsonb_build_object(
  'w',
  coalesce(
    snapshot->'w',
    to_jsonb(coalesce(nullif(trim(coalesce(snapshot->>'workspaceVariant', '')), ''), 'hubspot'))
  ),
  'ct',
  coalesce(snapshot->'ct', snapshot->'appliedCouponType', 'null'::jsonb),
  'cp',
  coalesce(snapshot->'cp', snapshot->'appliedCouponPercentageOff', 'null'::jsonb),
  'cb',
  coalesce(snapshot->'cb', snapshot->'couponBaseQuotedPrice', 'null'::jsonb),
  'i',
  '[]'::jsonb
)
where coalesce(jsonb_typeof(snapshot), 'null') = 'object';

alter table public.sales_proposal_snapshots enable row level security;
