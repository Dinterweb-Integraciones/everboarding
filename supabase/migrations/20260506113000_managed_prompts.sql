create table if not exists public.managed_prompts (
  id uuid primary key default gen_random_uuid(),
  prompt_text text not null check (nullif(trim(prompt_text), '') is not null),
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists managed_prompts_updated_idx
on public.managed_prompts (updated_at desc, created_at desc);

drop trigger if exists set_managed_prompts_updated_at on public.managed_prompts;
create trigger set_managed_prompts_updated_at
before update on public.managed_prompts
for each row execute procedure public.set_current_timestamp_updated_at();

alter table public.managed_prompts enable row level security;

drop policy if exists "managed_prompts_read_authenticated" on public.managed_prompts;
drop policy if exists "managed_prompts_manage_authenticated" on public.managed_prompts;

create policy "managed_prompts_read_authenticated"
on public.managed_prompts
for select
to authenticated
using (true);

create policy "managed_prompts_manage_authenticated"
on public.managed_prompts
for all
to authenticated
using (true)
with check (true);
