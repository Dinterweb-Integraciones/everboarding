-- Adds CS-focused task metadata: labels per use case, status/date per task.

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'initiative_task_status'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.initiative_task_status as enum ('pending', 'in_progress', 'blocked', 'completed');
  end if;
end;
$$;

alter table public.onboarding_initiatives
add column if not exists labels text[] not null default '{}'::text[];

alter table public.onboarding_initiative_subitems
add column if not exists status public.initiative_task_status not null default 'pending',
add column if not exists target_date date;
