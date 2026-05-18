create type public.platform_role as enum ('superadmin', 'admin', 'sales', 'csm');

alter table public.profiles
add column if not exists platform_role public.platform_role,
add column if not exists is_platform_active boolean not null default false,
add column if not exists platform_invited_by_user_id uuid references auth.users(id) on delete set null,
add column if not exists platform_invited_at timestamptz,
add column if not exists platform_activated_at timestamptz;

create table if not exists public.platform_user_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  full_name text,
  role public.platform_role not null,
  invited_by_user_id uuid references auth.users(id) on delete set null,
  invited_user_id uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists set_platform_user_invites_updated_at on public.platform_user_invites;
create trigger set_platform_user_invites_updated_at
before update on public.platform_user_invites
for each row execute procedure public.set_current_timestamp_updated_at();
