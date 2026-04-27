create type public.sales_proposal_status as enum ('draft', 'checkout_pending', 'paid', 'board_activated', 'archived');

create table if not exists public.sales_proposals (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique default replace(gen_random_uuid()::text, '-', ''),
  title text not null default 'Propuesta comercial',
  seller_name text,
  seller_email text,
  seller_company text,
  client_name text not null,
  client_email text,
  client_company text,
  client_phone text,
  client_description text,
  assigned_csm_user_id uuid references auth.users(id) on delete set null,
  start_date date not null default current_date,
  contracted_credits integer not null default 80 check (contracted_credits >= 0),
  quoted_price numeric(10, 2) not null default 0 check (quoted_price >= 0),
  currency text not null default 'usd',
  billing_mode public.custom_plan_billing_mode not null default 'subscription',
  plan_period_months integer not null default 1 check (plan_period_months in (1, 3, 6, 12)),
  status public.sales_proposal_status not null default 'draft',
  snapshot jsonb not null default '{"initiatives":[]}'::jsonb,
  hubspot_deal_id text,
  hubspot_pipeline_id text,
  hubspot_deal_stage_id text,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  stripe_subscription_id text,
  activated_client_id uuid references public.clients(id) on delete set null,
  paid_at timestamptz,
  activated_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists sales_proposals_status_idx on public.sales_proposals (status, updated_at desc);
create index if not exists sales_proposals_assigned_csm_user_id_idx on public.sales_proposals (assigned_csm_user_id);

drop trigger if exists set_sales_proposals_updated_at on public.sales_proposals;
create trigger set_sales_proposals_updated_at
before update on public.sales_proposals
for each row execute procedure public.set_current_timestamp_updated_at();

alter table public.sales_proposals enable row level security;
