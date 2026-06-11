create table if not exists public.onboarding_north_star_history (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  north_star_text text not null,
  north_star_status text not null default 'pending'
    check (north_star_status in ('pending', 'cs_preapproved', 'client_approved', 'completed')),
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists onboarding_north_star_history_client_idx
on public.onboarding_north_star_history (client_id, created_at desc);

create or replace function public.log_north_star_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(btrim(coalesce(new.north_star_text, '')), '') is not null
     and (
       tg_op = 'INSERT'
       or coalesce(old.north_star_text, '') is distinct from coalesce(new.north_star_text, '')
     ) then
    insert into public.onboarding_north_star_history (
      client_id,
      north_star_text,
      north_star_status,
      created_by_user_id
    )
    values (
      new.client_id,
      btrim(new.north_star_text),
      new.north_star_status,
      new.north_star_updated_by_user_id
    );
  end if;

  return new;
end;
$$;

drop trigger if exists log_north_star_history_on_config_write on public.onboarding_configs;
create trigger log_north_star_history_on_config_write
after insert or update of north_star_text on public.onboarding_configs
for each row execute procedure public.log_north_star_history();

insert into public.onboarding_north_star_history (
  client_id,
  north_star_text,
  north_star_status,
  created_by_user_id,
  created_at
)
select
  config.client_id,
  btrim(config.north_star_text),
  config.north_star_status,
  config.north_star_updated_by_user_id,
  coalesce(
    config.north_star_completed_at,
    config.north_star_client_approved_at,
    config.north_star_cs_preapproved_at,
    config.updated_at,
    timezone('utc', now())
  )
from public.onboarding_configs config
where nullif(btrim(coalesce(config.north_star_text, '')), '') is not null
  and not exists (
    select 1
    from public.onboarding_north_star_history history
    where history.client_id = config.client_id
      and history.north_star_text = btrim(config.north_star_text)
  );

alter table public.onboarding_north_star_history enable row level security;

drop policy if exists "north_star_history_select_accessible" on public.onboarding_north_star_history;
drop policy if exists "north_star_history_insert_editors" on public.onboarding_north_star_history;

create policy "north_star_history_select_accessible"
on public.onboarding_north_star_history
for select
to authenticated
using (public.can_view_client(client_id));

create policy "north_star_history_insert_editors"
on public.onboarding_north_star_history
for insert
to authenticated
with check (public.can_edit_client(client_id));
