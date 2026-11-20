import { NextResponse } from "next/server";
import Stripe from "stripe";

import { requireUser } from "@/lib/auth";
import { toStripeUnitAmount } from "@/lib/currency";
import { getClientBillingCurrency } from "@/lib/price-lists-server";
import { getPlanPeriodLabel, suggestPlanPrice } from "@/lib/onboarding";
import { isAwaitingStripeMembership } from "@/lib/membership-checkout";
import { canManagePlatformUsers } from "@/lib/platform-access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatUserError } from "@/lib/utils";
import { resolveAppOrigin } from "@/lib/app-origin";

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("La pasarela de pago no esta configurada.");
  }

  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

function resolveOrigin(request: Request) {
  return resolveAppOrigin(request);
}

// Link de pago de la membresía (Stripe, modo suscripción) para un cliente que pasó de paquetes a
// recurrencia con Stripe y aún no tiene suscripción (isAwaitingStripeMembership). Solo superadmin.
// El primer ciclo empieza el día del pago (anchorAwaitingMembershipToPaymentDate). La sesión lleva
// la misma metadata que la del checkout público, así que el webhook registra el ciclo pagado y las
// renovaciones (invoice.paid) igual que en cualquier membresía.
export async function POST(
  request: Request,
  context: { params: Promise<{ clientId: string }> },
) {
  try {
    const { platformProfile } = await requireUser("/dashboard");

    if (!canManagePlatformUsers(platformProfile?.platform_role ?? null)) {
      return NextResponse.json(
        { message: "Solo un superadmin puede generar el link de membresía." },
        { status: 403 },
      );
    }

    const { clientId } = await context.params;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createSupabaseAdminClient() as any;
    const [
      { data: client, error: clientError },
      { data: config, error: configError },
      awaitingStripeMembership,
    ] = await Promise.all([
      admin.from("clients").select("id, name, slug, description").eq("id", clientId).maybeSingle(),
      admin.from("onboarding_configs").select("*").eq("client_id", clientId).maybeSingle(),
      isAwaitingStripeMembership(clientId),
    ]);

    if (clientError) throw clientError;
    if (configError) throw configError;

    if (!client || !config) {
      return NextResponse.json({ message: "No encontramos el cliente." }, { status: 404 });
    }
    // Solo clientes que pasaron a recurrencia con Stripe y aún no tienen suscripción: una segunda
    // suscripción duplicaría los cobros, y los de transferencia se cobran desde Finanzas.
    if (config.custom_plan_billing_mode === "one_time" || !awaitingStripeMembership) {
      return NextResponse.json(
        { message: "Este cliente no necesita link de membresía." },
        { status: 400 },
      );
    }
    const contractedCredits = config.custom_plan_credits ?? config.base_capacity;
    const currency = await getClientBillingCurrency(client.id);
    const amountInCents = toStripeUnitAmount(
      Number(config.custom_plan_price ?? suggestPlanPrice(contractedCredits)),
      currency,
    );
    const periodMonths = config.custom_plan_period_months ?? 1;

    if (!Number.isFinite(amountInCents) || amountInCents <= 0) {
      return NextResponse.json(
        { message: "El cliente no tiene un precio valido para cobrar." },
        { status: 400 },
      );
    }

    const publicClientUrl = `${resolveOrigin(request)}/public/client/${client.id}`;
    const metadata = {
      client_id: client.id,
      client_slug: client.slug,
      audience: "client",
      purchase_kind: "plan",
      billing_kind: "subscription",
      period_months: String(periodMonths),
      extra_capacity_credits: "0",
    };
    const productDescription =
      client.description || "Membresia recurrente de onboarding y acompanamiento operativo.";
    const session = await getStripe().checkout.sessions.create({
      mode: "subscription",
      submit_type: "subscribe",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: amountInCents,
            recurring: { interval: "month", interval_count: periodMonths },
            product_data: {
              name: `Membresia Onboarding ${getPlanPeriodLabel(periodMonths)} - ${client.name}`,
              description: productDescription,
            },
          },
        },
      ],
      metadata,
      subscription_data: { description: productDescription, metadata },
      consent_collection: { terms_of_service: "required" },
      success_url: `${publicClientUrl}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${publicClientUrl}?payment=cancelled`,
    });

    if (!session.url) {
      return NextResponse.json({ message: "No pudimos crear el link de pago." }, { status: 500 });
    }

    return NextResponse.json({ url: session.url });
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos generar el link de membresía.") },
      { status: 400 },
    );
  }
}
