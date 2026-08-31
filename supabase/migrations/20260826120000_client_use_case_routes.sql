-- Tracks, per client, an ordered "tentative route" of catalog use cases the CS
-- picked to orient the client's next steps. Purely a guide: it does not create
-- or affect any initiative.

create table if not exists public.client_use_case_routes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  group_id uuid not null references public.credit_catalog_groups(id) on delete cascade,
  position integer not null,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (client_id, group_id)
);

alter table public.client_use_case_routes
add column if not exists icon text;

create index if not exists client_use_case_routes_client_idx
on public.client_use_case_routes (client_id);

create index if not exists client_use_case_routes_group_idx
on public.client_use_case_routes (group_id);

drop trigger if exists set_client_use_case_routes_updated_at
on public.client_use_case_routes;
create trigger set_client_use_case_routes_updated_at
before update on public.client_use_case_routes
for each row execute procedure public.set_current_timestamp_updated_at();

alter table public.client_use_case_routes enable row level security;

drop policy if exists "client_use_case_routes_read_authenticated" on public.client_use_case_routes;
drop policy if exists "client_use_case_routes_manage_authenticated" on public.client_use_case_routes;

create policy "client_use_case_routes_read_authenticated"
on public.client_use_case_routes
for select
to authenticated
using (true);

create policy "client_use_case_routes_manage_authenticated"
on public.client_use_case_routes
for all
to authenticated
using (true)
with check (true);
