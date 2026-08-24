-- Tracks, per client, which use cases from the catalog map have been completed.
-- Lets a CS build a client-specific view of the use case map and mark progress.

create table if not exists public.client_use_case_progress (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  group_id uuid not null references public.credit_catalog_groups(id) on delete cascade,
  is_completed boolean not null default false,
  completed_at timestamptz,
  notes text,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (client_id, group_id)
);

create index if not exists client_use_case_progress_client_idx
on public.client_use_case_progress (client_id);

create index if not exists client_use_case_progress_group_idx
on public.client_use_case_progress (group_id);

drop trigger if exists set_client_use_case_progress_updated_at
on public.client_use_case_progress;
create trigger set_client_use_case_progress_updated_at
before update on public.client_use_case_progress
for each row execute procedure public.set_current_timestamp_updated_at();

-- Keeps completed_at consistent even when the app only ever writes is_completed.
create or replace function public.set_client_use_case_progress_completed_at()
returns trigger
language plpgsql
as $$
begin
  if new.is_completed then
    if tg_op = 'INSERT' or not old.is_completed then
      new.completed_at := coalesce(new.completed_at, timezone('utc', now()));
    end if;
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists set_client_use_case_progress_completed_at
on public.client_use_case_progress;
create trigger set_client_use_case_progress_completed_at
before insert or update on public.client_use_case_progress
for each row execute procedure public.set_client_use_case_progress_completed_at();

alter table public.client_use_case_progress enable row level security;

drop policy if exists "client_use_case_progress_read_authenticated" on public.client_use_case_progress;
drop policy if exists "client_use_case_progress_manage_authenticated" on public.client_use_case_progress;

create policy "client_use_case_progress_read_authenticated"
on public.client_use_case_progress
for select
to authenticated
using (true);

create policy "client_use_case_progress_manage_authenticated"
on public.client_use_case_progress
for all
to authenticated
using (true)
with check (true);
