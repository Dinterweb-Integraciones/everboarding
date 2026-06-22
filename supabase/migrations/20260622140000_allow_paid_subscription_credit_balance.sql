create or replace function public.enforce_paid_cycle_for_reserved_initiatives()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  billing_status jsonb;
begin
  if new.status in ('planned', 'executing')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    billing_status := public.get_client_billing_status(new.client_id);

    if not coalesce((billing_status ->> 'current_cycle_paid')::boolean, false)
       and coalesce((billing_status ->> 'active_credits')::integer, 0) <= 0 then
      raise exception 'El cliente debe tener un pago activo o creditos vigentes para usar Planificado o En ejecucion';
    end if;
  end if;

  return new;
end;
$$;
