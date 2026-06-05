do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'client_access_role'
      and n.nspname = 'public'
  ) then
    create type public.client_access_role as enum ('viewer', 'editor', 'owner');
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.clients') is null
     or to_regclass('public.profiles') is null
     or to_regclass('public.client_members') is null then
    raise notice 'Skipping current_client_role update because client tables do not exist yet.';
    return;
  end if;

  execute $function$
    create or replace function public.current_client_role(target_client_id uuid)
    returns public.client_access_role
    language sql
    stable
    security definer
    set search_path = public
    as $body$
      select case
        when exists (
          select 1
          from public.clients c
          where c.id = target_client_id
            and c.owner_user_id = auth.uid()
        ) then 'owner'::public.client_access_role
        when exists (
          select 1
          from public.profiles p
          where p.id = auth.uid()
            and p.is_platform_active = true
            and p.platform_role in ('admin', 'superadmin')
        ) then 'editor'::public.client_access_role
        else (
          select cm.access_role
          from public.client_members cm
          where cm.client_id = target_client_id
            and cm.user_id = auth.uid()
          limit 1
        )
      end;
    $body$;
  $function$;
end;
$$;
