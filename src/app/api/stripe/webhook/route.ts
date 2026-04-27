import { NextResponse } from "next/server";
import Stripe from "stripe";

import { activateSalesProposalAfterPayment } from "@/lib/sales-proposals-server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatUserError } from "@/lib/utils";
import type { Database } from "@/types/database";

type PaymentRecordInput = {
  clientId: string;
  checkoutSessionId?: string | null;
  paymentIntentId?: string | null;
  subscriptionId?: string | null;
  invoiceId?: string | null;
  amountCents: number;
  currency: string;
};

type RecordStripeCheckoutPaymentArgs =
  Database["public"]["Functions"]["record_stripe_checkout_payment"]["Args"];

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("La pasarela de pago no esta configurada.");
  }

  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

function getWebhookSecret() {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    throw new Error("El webhook de Stripe no esta configurado.");
  }

  return process.env.STRIPE_WEBHOOK_SECRET;
}

function getObjectId(value: string | { id?: string } | null | undefined) {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.id ?? null;
}

function getInvoiceSubscriptionId(invoice: Stripe.Invoice) {
  return getObjectId(invoice.parent?.subscription_details?.subscription);
}

function getInvoicePaymentIntentId(invoice: Stripe.Invoice) {
  const paymentIntent = invoice.payments?.data.find(
    (payment) => payment.payment.type === "payment_intent",
  )?.payment.payment_intent;

  return getObjectId(paymentIntent);
}

async function recordPayment(input: PaymentRecordInput) {
  const supabase = createSupabaseAdminClient();
  const paymentArgs: RecordStripeCheckoutPaymentArgs = {
    p_client_id: input.clientId,
    p_checkout_session_id: input.checkoutSessionId ?? null,
    p_payment_intent_id: input.paymentIntentId ?? null,
    p_amount_cents: input.amountCents,
    p_currency: input.currency,
    p_stripe_subscription_id: input.subscriptionId ?? null,
    p_stripe_invoice_id: input.invoiceId ?? null,
  };

  return supabase.rpc("record_stripe_checkout_payment" as never, paymentArgs as never);
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const salesProposalId = session.metadata?.sales_proposal_id;

  if (salesProposalId) {
    const stripe = getStripe();
    await activateSalesProposalAfterPayment(stripe, salesProposalId, session);
    return NextResponse.json({ received: true });
  }

  const clientId = session.metadata?.client_id;

  if (!clientId) {
    return NextResponse.json(
      { message: "La sesion de pago no tiene cliente asociado." },
      { status: 400 },
    );
  }

  const { error } = await recordPayment({
    clientId,
    checkoutSessionId: session.id,
    paymentIntentId: getObjectId(session.payment_intent),
    subscriptionId: getObjectId(session.subscription),
    invoiceId: getObjectId(session.invoice),
    amountCents: session.amount_total ?? 0,
    currency: session.currency ?? "usd",
  });

  if (error) {
    return NextResponse.json(
      {
        message: formatUserError(error, "No pudimos registrar el pago del onboarding."),
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true });
}

async function handleInvoicePaid(stripe: Stripe, invoice: Stripe.Invoice) {
  const subscriptionId = getInvoiceSubscriptionId(invoice);

  if (!subscriptionId) {
    return NextResponse.json({ received: true });
  }

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const metadata = invoice.parent?.subscription_details?.metadata ?? subscription.metadata;
  const clientId = metadata?.client_id;

  if (!clientId) {
    return NextResponse.json(
      { message: "La membresia de Stripe no tiene cliente asociado." },
      { status: 400 },
    );
  }

  const { error } = await recordPayment({
    clientId,
    checkoutSessionId: null,
    paymentIntentId: getInvoicePaymentIntentId(invoice),
    subscriptionId,
    invoiceId: invoice.id,
    amountCents: invoice.amount_paid,
    currency: invoice.currency ?? "usd",
  });

  if (error) {
    return NextResponse.json(
      {
        message: formatUserError(error, "No pudimos registrar la renovacion del onboarding."),
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true });
}

export async function POST(request: Request) {
  const stripe = getStripe();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ message: "Firma de Stripe no recibida." }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    const rawBody = await request.text();
    event = stripe.webhooks.constructEvent(rawBody, signature, getWebhookSecret());
  } catch (caughtError) {
    return NextResponse.json(
      {
        message: formatUserError(caughtError, "No pudimos validar el evento de Stripe."),
      },
      { status: 400 },
    );
  }

  if (event.type === "checkout.session.completed") {
    return handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
  }

  if (event.type === "invoice.paid" || event.type === "invoice.payment_succeeded") {
    return handleInvoicePaid(stripe, event.data.object as Stripe.Invoice);
  }

  return NextResponse.json({ received: true });
}
