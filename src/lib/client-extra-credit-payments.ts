import {
  EXTRA_CREDIT_PACKAGE_PURCHASE_KIND,
  PUBLIC_EXTRA_CREDIT_PACKAGE,
} from "@/lib/constants";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatUserError } from "@/lib/utils";

type ExtraCreditPackagePaymentInput = {
  clientId: string;
  checkoutSessionId?: string | null;
  paymentIntentId?: string | null;
  amountCents: number;
  currency: string;
  grantedCredits?: number;
};

export function isExtraCreditPackagePurchase(
  metadata: Record<string, string | undefined> | null | undefined,
) {
  return metadata?.purchase_kind === EXTRA_CREDIT_PACKAGE_PURCHASE_KIND;
}

export function getExtraCreditPackageCredits(
  metadata: Record<string, string | undefined> | null | undefined,
) {
  const credits = Number(metadata?.extra_capacity_credits);

  return Number.isFinite(credits) && credits > 0
    ? Math.round(credits)
    : PUBLIC_EXTRA_CREDIT_PACKAGE.credits;
}

export async function recordExtraCreditPackagePayment(
  input: ExtraCreditPackagePaymentInput,
) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc(
    "record_extra_credit_package_payment" as never,
    {
      p_client_id: input.clientId,
      p_checkout_session_id: input.checkoutSessionId ?? null,
      p_payment_intent_id: input.paymentIntentId ?? null,
      p_amount_cents: input.amountCents,
      p_currency: input.currency,
      p_granted_credits: input.grantedCredits ?? PUBLIC_EXTRA_CREDIT_PACKAGE.credits,
    } as never,
  );

  if (error) {
    throw new Error(
      formatUserError(error, "No pudimos habilitar los créditos extra del cliente."),
    );
  }

  return data;
}

export async function fetchClientBillingStatus(clientId: string) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc(
    "get_client_billing_status" as never,
    {
      p_client_id: clientId,
    } as never,
  );

  if (error) {
    throw new Error(
      formatUserError(error, "El pago se registró, pero no pudimos actualizar el estado."),
    );
  }

  return data;
}
