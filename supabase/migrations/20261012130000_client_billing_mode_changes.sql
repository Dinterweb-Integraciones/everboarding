-- Registro de los cambios de forma de cobro de un cliente (p. ej. de paquetes a recurrencia), que
-- un superadmin hace desde el board. Guarda quién lo hizo, cuándo y la oferta con la que quedó.
-- Solo se escribe desde el servidor (service role); los superadmin pueden consultarlo.
create table if not exists public.client_billing_mode_changes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  from_mode public.custom_plan_billing_mode not null,
  to_mode public.custom_plan_billing_mode not null,
  payment_method public.sales_payment_method not null,
  first_cycle_start_date date not null,
  -- Oferta con la que queda el cliente: créditos, periodo, precio, caudal y vigencia.
  details jsonb not null default '{}'::jsonb,
  changed_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists client_billing_mode_changes_client_idx
  on public.client_billing_mode_changes (client_id, created_at desc);

alter table public.client_billing_mode_changes enable row level security;

drop policy if exists "client_billing_mode_changes_select_superadmin" on public.client_billing_mode_changes;
create policy "client_billing_mode_changes_select_superadmin"
on public.client_billing_mode_changes for select to authenticated
using (
  exists (
    select 1 from public.profiles
    where id = auth.uid()
      and is_platform_active = true
      and platform_role = 'superadmin'
  )
);
