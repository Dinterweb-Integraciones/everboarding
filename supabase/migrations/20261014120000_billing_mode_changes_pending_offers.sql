-- client_billing_mode_changes también guarda la oferta de recurrencia que un superadmin define para
-- un cliente de paquetes ("Únete a Everboarding" en su vista pública). Una fila sin applied_at es la
-- oferta pendiente (a lo más una por cliente); cuando el cliente la paga en Stripe se marca como
-- aplicada, con la fecha de su primer ciclo, y queda como registro del cambio de forma de cobro.
-- Sin oferta pendiente, la vista pública usa la oferta por defecto (ver lib/recurrence-offer).
alter table public.client_billing_mode_changes
  add column if not exists applied_at timestamptz,
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

-- Los cambios registrados hasta ahora se aplicaron al guardarse.
update public.client_billing_mode_changes
set applied_at = created_at
where applied_at is null;

create unique index if not exists client_billing_mode_changes_pending_offer_idx
  on public.client_billing_mode_changes (client_id)
  where applied_at is null;
