create table if not exists public.north_star_audits (
  north_star_history_id uuid primary key references public.onboarding_north_star_history(id) on delete cascade,
  is_from boolean not null default false,
  is_until boolean not null default false,
  is_timed boolean not null default false,
  is_crucial boolean not null default false,
  has_associated_use_cases boolean not null default false,
  notes text not null default '',
  updated_by_user_id uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.north_star_audits enable row level security;

drop policy if exists "north_star_audits_select_authenticated" on public.north_star_audits;
create policy "north_star_audits_select_authenticated"
on public.north_star_audits for select to authenticated using (true);

drop policy if exists "north_star_audits_manage_admins" on public.north_star_audits;
create policy "north_star_audits_manage_admins"
on public.north_star_audits for all to authenticated
using (
  exists (
    select 1 from public.profiles
    where id = auth.uid()
      and is_platform_active = true
      and platform_role in ('admin', 'superadmin')
  )
)
with check (
  exists (
    select 1 from public.profiles
    where id = auth.uid()
      and is_platform_active = true
      and platform_role in ('admin', 'superadmin')
  )
);
