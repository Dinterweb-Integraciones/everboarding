-- Cada caso de uso consume créditos del paquete (grant) vigente el día en que se comprometió
-- (entró a Planificado, En ejecución o Completado), no del más antiguo. Antes se repartía todo lo
-- comprometido del grant más antiguo al más nuevo sin mirar fechas, así que un caso comprometido
-- después de vencer un paquete se cargaba a ese paquete vencido ("revivía" créditos vencidos) en
-- lugar de descontarse del paquete vigente.
--
-- El nuevo reparto se activa por cliente con onboarding_configs.credit_allocation_by_commit_date.
-- Apagado (por defecto) el cliente conserva el reparto anterior, idéntico al de antes.

alter table public.onboarding_configs
add column if not exists credit_allocation_by_commit_date boolean not null default false;

comment on column public.onboarding_configs.credit_allocation_by_commit_date is
  'true: cada caso consume del paquete vigente cuando se comprometió. false: reparto anterior (del paquete más antiguo al más nuevo).';

alter table public.onboarding_initiatives
add column if not exists committed_at timestamptz;

comment on column public.onboarding_initiatives.committed_at is
  'Momento en que el caso pasó de En evaluación a Planificado/En ejecución/Completado. Null en En evaluación. Define de qué paquete de créditos consume.';

-- Casos ya comprometidos. Si volvieron a En evaluación alguna vez, se toma el primer cambio a una
-- columna comprometida posterior a esa vuelta. Si no, la fecha de creación. Ante la duda se elige
-- la fecha más temprana posible, que es la que conserva el reparto anterior: el saldo solo cambia
-- donde el historial muestra que el caso se comprometió después de vencer su paquete.
-- El relleno no debe tocar updated_at: los informes lo usan como fecha de completado y de
-- permanencia en la etapa. Los demás triggers de la tabla solo corren al cambiar status.
alter table public.onboarding_initiatives disable trigger set_onboarding_initiatives_updated_at;

with last_backlog as (
  select l.initiative_id, max(l.created_at) as backlog_at
  from public.onboarding_activity_logs l
  where l.entry ilike 'Cambio a En evaluaci%'
  group by l.initiative_id
)
update public.onboarding_initiatives i
set committed_at = coalesce(
  case
    when lb.backlog_at is null then i.created_at
    else coalesce(
      (
        select min(l.created_at)
        from public.onboarding_activity_logs l
        where l.initiative_id = i.id
          and l.created_at > lb.backlog_at
          and (
            l.entry ilike 'Cambio a Planificado%'
            or l.entry ilike 'Cambio a En ejecuci%'
            or l.entry ilike 'Cambio a Completado%'
          )
      ),
      lb.backlog_at
    )
  end,
  i.created_at
)
from public.onboarding_initiatives i2
left join last_backlog lb on lb.initiative_id = i2.id
where i2.id = i.id
  and i.status in ('planned', 'executing', 'completed')
  and i.committed_at is null;

alter table public.onboarding_initiatives enable trigger set_onboarding_initiatives_updated_at;

create or replace function public.set_onboarding_initiative_committed_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status in ('planned', 'executing', 'completed') then
    if tg_op = 'INSERT' then
      new.committed_at := coalesce(new.committed_at, timezone('utc', now()));
    elsif old.status in ('planned', 'executing', 'completed') then
      -- Moverlo entre columnas comprometidas no cambia de qué paquete consume.
      new.committed_at := coalesce(old.committed_at, new.committed_at, timezone('utc', now()));
    else
      new.committed_at := timezone('utc', now());
    end if;
  else
    new.committed_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists set_onboarding_initiative_committed_at_on_write on public.onboarding_initiatives;
create trigger set_onboarding_initiative_committed_at_on_write
before insert or update of status on public.onboarding_initiatives
for each row
execute function public.set_onboarding_initiative_committed_at();

-- Reparto de lo comprometido entre los grants del cliente. Cada caso, en orden de compromiso,
-- consume primero de los grants vigentes ese día (el que vence antes primero), luego de los que
-- empiezan después y aún no vencían ese día, y solo si no alcanza, de cualquier grant con saldo
-- (comportamiento anterior), para no dejar consumo sin asignar. Sin el reparto por fecha activado,
-- solo se usa ese último paso, que es exactamente el reparto anterior.
create or replace function public.expire_unused_client_credits(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  grant_ids uuid[];
  grant_dates date[];
  grant_expirations date[];
  grant_amounts integer[];
  grant_used integer[];
  grant_count integer;
  initiative_record record;
  commit_date date;
  pending integer;
  tier integer;
  idx integer;
  available integer;
  taken integer;
  first_tier integer;
begin
  select case when coalesce(oc.credit_allocation_by_commit_date, false) then 1 else 3 end
  into first_tier
  from public.onboarding_configs oc
  where oc.client_id = p_client_id;

  first_tier := coalesce(first_tier, 3);

  select
    coalesce(array_agg(g.id order by g.grant_date, g.created_at, g.id), '{}'),
    coalesce(array_agg(g.grant_date order by g.grant_date, g.created_at, g.id), '{}'),
    coalesce(array_agg(g.expires_at order by g.grant_date, g.created_at, g.id), '{}'),
    coalesce(array_agg(g.granted_credits order by g.grant_date, g.created_at, g.id), '{}'),
    coalesce(array_agg(0 order by g.grant_date, g.created_at, g.id), '{}')
  into grant_ids, grant_dates, grant_expirations, grant_amounts, grant_used
  from public.client_credit_grants g
  where g.client_id = p_client_id;

  grant_count := coalesce(array_length(grant_ids, 1), 0);
  if grant_count = 0 then
    return;
  end if;

  for initiative_record in
    select
      coalesce(i.committed_at, i.created_at) as committed_at,
      coalesce(sum(s.unit_credits * s.quantity), 0)::integer as credits
    from public.onboarding_initiatives i
    join public.onboarding_initiative_subitems s
      on s.initiative_id = i.id
    where i.client_id = p_client_id
      and i.status in ('planned', 'executing', 'completed')
    group by i.id
    order by coalesce(i.committed_at, i.created_at), i.created_at, i.id
  loop
    pending := greatest(initiative_record.credits, 0);
    commit_date := (initiative_record.committed_at at time zone 'utc')::date;

    tier := first_tier;
    while pending > 0 and tier <= 3 loop
      -- Tier 1: vigentes ese día, el que vence antes primero.
      for idx in
        select ordinality::integer
        from unnest(grant_dates, grant_expirations) with ordinality as t(grant_date, expires_at, ordinality)
        where case tier
          when 1 then t.grant_date <= commit_date and t.expires_at >= commit_date
          when 2 then t.grant_date > commit_date
          else true
        end
        order by
          case when tier = 1 then t.expires_at end,
          t.grant_date,
          ordinality
      loop
        exit when pending = 0;
        available := grant_amounts[idx] - grant_used[idx];
        if available > 0 then
          taken := least(available, pending);
          grant_used[idx] := grant_used[idx] + taken;
          pending := pending - taken;
        end if;
      end loop;

      tier := tier + 1;
    end loop;
  end loop;

  for idx in 1..grant_count loop
    update public.client_credit_grants
    set used_credits = grant_used[idx],
        expired_credits = case
          when grant_expirations[idx] < current_date
            then greatest(grant_amounts[idx] - grant_used[idx], 0)
          else 0
        end,
        updated_at = timezone('utc', now())
    where id = grant_ids[idx]
      and (
        used_credits is distinct from grant_used[idx]
        or expired_credits is distinct from case
          when grant_expirations[idx] < current_date
            then greatest(grant_amounts[idx] - grant_used[idx], 0)
          else 0
        end
      );
  end loop;
end;
$$;

grant execute on function public.expire_unused_client_credits(uuid) to authenticated;

-- Por ahora solo Alia usa el reparto por fecha de compromiso; se recalcula su saldo.
update public.onboarding_configs
set credit_allocation_by_commit_date = true
where client_id = '2254255a-a987-421a-b600-bf8a426953b7';

select public.expire_unused_client_credits('2254255a-a987-421a-b600-bf8a426953b7');
