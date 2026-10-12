-- Al pasar a recurrencia con Stripe no se define fecha: el primer ciclo empieza el día del pago
-- (anchorAwaitingMembershipToPaymentDate). Solo con transferencia se elige la fecha del primer ciclo.
alter table public.client_billing_mode_changes
  alter column first_cycle_start_date drop not null;
