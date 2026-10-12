import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Un cliente espera activar su membresía en Stripe cuando su último cambio de forma de cobro lo
// pasó a recurrencia con Stripe y aún no tiene suscripción en Stripe (ni en sus ciclos ni en su
// venta). Solo a esos clientes se les genera el link de membresía; el resto de los recurrentes
// renueva solo (Stripe) o desde la cola de Finanzas (transferencia).
export async function isAwaitingStripeMembership(clientId: string) {
  // client_billing_mode_changes no está en database.ts (ver límite de complejidad de tipos).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createSupabaseAdminClient() as any;
  const [
    { data: latestChange, error: changeError },
    { data: subscribedCycles, error: cyclesError },
    { data: subscribedProposals, error: proposalsError },
  ] = await Promise.all([
    admin
      .from("client_billing_mode_changes")
      .select("to_mode, payment_method")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("client_billing_cycles")
      .select("id")
      .eq("client_id", clientId)
      .not("stripe_subscription_id", "is", null)
      .limit(1),
    admin
      .from("sales_proposals")
      .select("id")
      .eq("activated_client_id", clientId)
      .not("stripe_subscription_id", "is", null)
      .limit(1),
  ]);

  if (changeError) throw changeError;
  if (cyclesError) throw cyclesError;
  if (proposalsError) throw proposalsError;

  return (
    latestChange?.to_mode === "subscription" &&
    latestChange.payment_method === "stripe" &&
    !subscribedCycles?.length &&
    !subscribedProposals?.length
  );
}

// Al registrar el primer pago de un cliente que pasó a recurrencia con Stripe, su primer ciclo
// empieza el día del pago: ese día queda como día de corte (onboarding_configs.start_date, que usa
// get_client_cycle_window). Llamar justo antes de record_stripe_checkout_payment; para los demás
// clientes no hace nada. Una vez registrado el pago el ciclo ya tiene la suscripción, así que los
// avisos repetidos de Stripe (checkout, factura, sincronización) no vuelven a mover la fecha.
export async function anchorAwaitingMembershipToPaymentDate(clientId: string) {
  if (!(await isAwaitingStripeMembership(clientId))) return;

  // Fecha UTC, la misma que current_date en la base.
  const paymentDate = new Date().toISOString().slice(0, 10);
  const { error } = await createSupabaseAdminClient()
    .from("onboarding_configs")
    .update({ start_date: paymentDate, updated_at: new Date().toISOString() } as never)
    .eq("client_id", clientId);

  if (error) throw error;
}
