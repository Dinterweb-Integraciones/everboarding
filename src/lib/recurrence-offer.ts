import { normalizePlanPeriodMonths, type PlanPeriodMonths } from "@/lib/onboarding";
import { safeParseNumber } from "@/lib/utils";

// Oferta con la que un cliente de paquetes pasa a recurrencia desde su vista pública
// ("Únete a Everboarding"). La define un superadmin como cambio de forma de cobro pendiente
// (client_billing_mode_changes sin applied_at, con la oferta en details); sin oferta pendiente se
// usa DEFAULT_RECURRENCE_OFFER.
export type RecurrenceOffer = {
  credits: number;
  periodMonths: PlanPeriodMonths;
  // Lo que paga el cliente por periodo.
  price: number;
  // Ahorro en créditos frente a comprar paquetes; ya está incluido en credits. Solo se comunica al
  // cliente: no cambia ni el precio ni los créditos.
  creditSavingsPercent: number;
  flowCredits: number | null;
  creditValidityDays: number;
};

// 80 CR al mes por USD 1,197 con caudal de 80; el 15% de ahorro en créditos ya va en los 80 CR.
export const DEFAULT_RECURRENCE_OFFER: RecurrenceOffer = {
  credits: 80,
  periodMonths: 1,
  price: 1197,
  creditSavingsPercent: 15,
  flowCredits: 80,
  creditValidityDays: 60,
};

// La oferta se guarda en client_billing_mode_changes.details con estas mismas llaves.
export function parseRecurrenceOfferDetails(details: unknown): RecurrenceOffer | null {
  if (!details || typeof details !== "object") return null;

  const value = details as Record<string, unknown>;
  const credits = Math.floor(safeParseNumber(value.credits as number));
  const price = safeParseNumber(value.price as number);
  const creditValidityDays = Math.floor(safeParseNumber(value.creditValidityDays as number));

  if (credits <= 0 || price <= 0 || creditValidityDays <= 0) return null;

  return {
    credits,
    periodMonths: normalizePlanPeriodMonths(safeParseNumber(value.periodMonths as number)),
    price,
    creditSavingsPercent: safeParseNumber(value.creditSavingsPercent as number),
    flowCredits:
      value.flowCredits === null || value.flowCredits === undefined
        ? null
        : Math.floor(safeParseNumber(value.flowCredits as number)),
    creditValidityDays,
  };
}

// La oferta viaja en la metadata de la sesión y de la suscripción de Stripe: al confirmarse el pago
// (checkout, factura o sincronización) el cliente pasa a recurrencia con lo que pagó, aunque la
// oferta guardada haya cambiado después.
export const RECURRENCE_UPGRADE_METADATA_FLAG = "recurrence_upgrade";

export function buildRecurrenceUpgradeMetadata(offer: RecurrenceOffer) {
  return {
    [RECURRENCE_UPGRADE_METADATA_FLAG]: "1",
    recurrence_credits: String(offer.credits),
    recurrence_price: String(offer.price),
    recurrence_credit_savings_percent: String(offer.creditSavingsPercent),
    recurrence_flow_credits: offer.flowCredits === null ? "" : String(offer.flowCredits),
    recurrence_credit_validity_days: String(offer.creditValidityDays),
  };
}

export function parseRecurrenceUpgradeMetadata(
  metadata: Record<string, string> | null | undefined,
): RecurrenceOffer | null {
  if (metadata?.[RECURRENCE_UPGRADE_METADATA_FLAG] !== "1") return null;

  const credits = Math.floor(safeParseNumber(metadata.recurrence_credits));
  const creditValidityDays = Math.floor(safeParseNumber(metadata.recurrence_credit_validity_days));

  if (credits <= 0 || creditValidityDays <= 0) return null;

  return {
    credits,
    periodMonths: normalizePlanPeriodMonths(safeParseNumber(metadata.period_months)),
    price: safeParseNumber(metadata.recurrence_price),
    creditSavingsPercent: safeParseNumber(metadata.recurrence_credit_savings_percent),
    flowCredits: metadata.recurrence_flow_credits
      ? Math.floor(safeParseNumber(metadata.recurrence_flow_credits))
      : null,
    creditValidityDays,
  };
}
