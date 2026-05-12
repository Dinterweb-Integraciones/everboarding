import { NextResponse } from "next/server";
import Stripe from "stripe";

import {
  fetchClientBillingStatus,
  isExtraCreditPackagePurchase,
  recordExtraCreditPackagePayment,
} from "@/lib/client-extra-credit-payments";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatUserError } from "@/lib/utils";
import type { Database } from "@/types/database";

type SyncSessionRequestBody = {
  sessionId?: string;
  slug?: string;
};

type RecordStripeCheckoutPaymentArgs =
  Database["public"]["Functions"]["record_stripe_checkout_payment"]["Args"];

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("La pasarela de pago no esta configurada.");
  }

  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

function getObjectId(value: string | { id?: string } | null | undefined) {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.id ?? null;
}

export async function POST(request: Request) {
  try {
    const { sessionId, slug } = (await request.json()) as SyncSessionRequestBody;

    if (!sessionId) {
      return NextResponse.json(
        { message: "No recibimos la sesion de pago para confirmar." },
        { status: 400 },
      );
    }

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["invoice", "subscription"],
    });

    if (session.payment_status !== "paid") {
      return NextResponse.json(
        { message: "El pago aun no aparece como completado." },
        { status: 409 },
      );
    }

    const clientId = session.metadata?.client_id;
    const clientSlug = session.metadata?.client_slug;

    if (!clientId) {
      return NextResponse.json(
        { message: "La sesion de pago no tiene cliente asociado." },
        { status: 400 },
      );
    }

    if (slug && slug !== clientId && slug !== clientSlug) {
      return NextResponse.json(
        { message: "El pago no pertenece a este onboarding." },
        { status: 403 },
      );
    }

    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id ?? "";

    const purchaseKind = isExtraCreditPackagePurchase(session.metadata)
      ? "extra_capacity_package"
      : "plan";

    if (purchaseKind === "extra_capacity_package") {
      await recordExtraCreditPackagePayment({
        clientId,
        checkoutSessionId: session.id,
        paymentIntentId: paymentIntentId || null,
        amountCents: session.amount_total ?? 0,
        currency: session.currency ?? "usd",
      });
    } else {
      const supabase = createSupabaseAdminClient();
      const recordPaymentArgs: RecordStripeCheckoutPaymentArgs = {
        p_client_id: clientId,
        p_checkout_session_id: session.id,
        p_payment_intent_id: paymentIntentId || null,
        p_amount_cents: session.amount_total ?? 0,
        p_currency: session.currency ?? "usd",
        p_stripe_subscription_id: getObjectId(session.subscription),
        p_stripe_invoice_id: getObjectId(session.invoice),
      };

      const { error: recordError } = await supabase.rpc(
        "record_stripe_checkout_payment" as never,
        recordPaymentArgs as never,
      );

      if (recordError) {
        return NextResponse.json(
          {
            message: formatUserError(recordError, "No pudimos registrar el pago del onboarding."),
          },
          { status: 500 },
        );
      }
    }

    const billing = await fetchClientBillingStatus(clientId);
    return NextResponse.json({ billing, purchaseKind });
  } catch (caughtError) {
    return NextResponse.json(
      {
        message: formatUserError(caughtError, "No pudimos confirmar el pago."),
      },
      { status: 500 },
    );
  }
}
