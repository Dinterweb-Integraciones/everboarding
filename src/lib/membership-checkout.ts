import { getMonthlyContractCredits } from "@/lib/onboarding";
import {
  DEFAULT_RECURRENCE_OFFER,
  parseRecurrenceOfferDetails,
  parseRecurrenceUpgradeMetadata,
  type RecurrenceOffer,
} from "@/lib/recurrence-offer";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// La oferta de recurrencia de un cliente es su cambio de forma de cobro pendiente: la fila de
// client_billing_mode_changes sin applied_at (a lo más una por cliente), con la oferta en details.
// client_billing_mode_changes no está en database.ts (ver límite de complejidad de tipos).
async function fetchPendingOfferRow(clientId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createSupabaseAdminClient() as any;
  const { data, error } = (await admin
    .from("client_billing_mode_changes")
    .select("id, details")
    .eq("client_id", clientId)
    .is("applied_at", null)
    .maybeSingle()) as { data: { id: string; details: unknown } | null; error: Error | null };

  if (error) throw error;

  return data;
}

// Oferta de recurrencia del cliente: la que guardó un superadmin o, si no hay, la de por defecto.
export async function fetchRecurrenceOffer(clientId: string): Promise<RecurrenceOffer> {
  const row = await fetchPendingOfferRow(clientId);

  return parseRecurrenceOfferDetails(row?.details) ?? DEFAULT_RECURRENCE_OFFER;
}

// Guarda la oferta pendiente del cliente (la crea o la reemplaza).
export async function saveRecurrenceOffer(clientId: string, offer: RecurrenceOffer, userId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createSupabaseAdminClient() as any;
  const pendingRow = await fetchPendingOfferRow(clientId);
  const fields = {
    from_mode: "one_time",
    to_mode: "subscription",
    payment_method: "stripe",
    details: offer,
    changed_by_user_id: userId,
    updated_at: new Date().toISOString(),
  };
  const { error } = pendingRow
    ? await admin.from("client_billing_mode_changes").update(fields).eq("id", pendingRow.id)
    : await admin.from("client_billing_mode_changes").insert({ client_id: clientId, ...fields });

  if (error) throw error;
}

// Al confirmarse el pago de "Únete a Everboarding", el cliente pasa de paquetes a recurrencia con la
// oferta que pagó (viaja en la metadata de Stripe). Llamar antes de record_stripe_checkout_payment,
// que cobra según onboarding_configs. El saldo del paquete sigue vigente hasta su vencimiento.
// Checkout, factura y sincronización pueden llegar a la vez: solo el que cambia la configuración
// (sigue en one_time) registra el cambio y ajusta la venta. Devuelve true si la cambió.
export async function activateRecurrenceFromPayment(
  clientId: string,
  metadata: Record<string, string> | null | undefined,
) {
  const offer = parseRecurrenceUpgradeMetadata(metadata);
  if (!offer) return false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createSupabaseAdminClient() as any;
  const updatedAt = new Date().toISOString();
  // Fecha UTC, la misma que current_date en la base: el primer ciclo empieza el día del pago, que
  // queda como día de corte (get_client_cycle_window).
  const paymentDate = updatedAt.slice(0, 10);
  const { data: updatedConfigs, error: configError } = await admin
    .from("onboarding_configs")
    .update({
      custom_plan_billing_mode: "subscription",
      custom_plan_type: "mensual",
      custom_plan_period_months: offer.periodMonths,
      custom_plan_credits: offer.credits,
      base_capacity: getMonthlyContractCredits({
        base_capacity: offer.credits,
        custom_plan_credits: offer.credits,
        custom_plan_period_months: offer.periodMonths,
      }),
      custom_plan_price: offer.price,
      flow_credits: offer.flowCredits,
      credit_validity_days: offer.creditValidityDays,
      start_date: paymentDate,
      updated_at: updatedAt,
    })
    .eq("client_id", clientId)
    .eq("custom_plan_billing_mode", "one_time")
    .select("client_id");

  if (configError) throw configError;
  if (!updatedConfigs?.length) return false;

  // Venta con la que se activó el cliente (de ella dependen reportes y Finanzas).
  const { data: proposal, error: proposalError } = await admin
    .from("sales_proposals")
    .select("id")
    .eq("activated_client_id", clientId)
    .order("activated_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (proposalError) throw proposalError;

  if (proposal) {
    const { error: proposalUpdateError } = await admin
      .from("sales_proposals")
      .update({
        billing_mode: "subscription",
        payment_method: "stripe",
        plan_period_months: offer.periodMonths,
        contracted_credits: offer.credits,
        quoted_price: offer.price,
        flow_credits: offer.flowCredits,
        credit_validity_days: offer.creditValidityDays,
        updated_at: updatedAt,
      })
      .eq("id", proposal.id);

    if (proposalUpdateError) throw proposalUpdateError;
  }

  // La oferta pendiente queda aplicada con lo que se pagó; si no había (oferta por defecto), se
  // registra el cambio ya aplicado.
  const pendingRow = await fetchPendingOfferRow(clientId);
  const appliedFields = {
    from_mode: "one_time",
    to_mode: "subscription",
    payment_method: "stripe",
    first_cycle_start_date: paymentDate,
    details: {
      source: "client_checkout",
      credits: offer.credits,
      periodMonths: offer.periodMonths,
      price: offer.price,
      creditSavingsPercent: offer.creditSavingsPercent,
      flowCredits: offer.flowCredits,
      creditValidityDays: offer.creditValidityDays,
      salesProposalId: proposal?.id ?? null,
    },
    applied_at: updatedAt,
    updated_at: updatedAt,
  };
  const { error: logError } = pendingRow
    ? await admin.from("client_billing_mode_changes").update(appliedFields).eq("id", pendingRow.id)
    : await admin
        .from("client_billing_mode_changes")
        .insert({ client_id: clientId, ...appliedFields, changed_by_user_id: null });

  if (logError) throw logError;

  return true;
}

// Un cliente espera activar su membresía en Stripe cuando su último cambio de forma de cobro lo
// pasó a recurrencia con Stripe y aún no tiene suscripción en Stripe (ni en sus ciclos ni en su
// venta). Así quedaban los clientes que un superadmin pasaba a recurrencia antes de que el cliente
// pudiera hacerlo desde su vista pública; también quien acaba de pagar "Únete a Everboarding".
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
      // Las ofertas pendientes no son cambios hechos.
      .not("applied_at", "is", null)
      .order("applied_at", { ascending: false })
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
