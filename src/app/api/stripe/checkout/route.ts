import { NextResponse } from "next/server";
import Stripe from "stripe";

import { EXTRA_CREDIT_PACKAGE_PURCHASE_KIND, PUBLIC_EXTRA_CREDIT_PACKAGE } from "@/lib/constants";
import {
  getPlanPeriodLabel,
  suggestPlanPrice,
  type OnboardingConfig,
  type PublicClientSummary,
  type PublicOnboardingAudience,
} from "@/lib/onboarding";
import { buildPublicProspectSnapshotBase, getSalesProposalBySlug } from "@/lib/public-prospect";
import { activateSalesProposal } from "@/lib/sales-proposals-server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatUserError } from "@/lib/utils";

type CheckoutRequestBody = {
  audience?: PublicOnboardingAudience;
  slug?: string;
  purchaseKind?: "plan" | "extra_package";
};

type PublicOnboardingRpcResponse = {
  client: PublicClientSummary;
  config: OnboardingConfig;
};

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("La pasarela de pago no esta configurada.");
  }

  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

function resolveOrigin(request: Request) {
  const requestOrigin = request.headers.get("origin") || new URL(request.url).origin;

  if (requestOrigin.includes("localhost") || requestOrigin.includes("127.0.0.1")) {
    return requestOrigin.replace(/\/$/, "");
  }

  return (process.env.NEXT_PUBLIC_SITE_URL || requestOrigin).replace(/\/$/, "");
}

function resolveCurrency() {
  return (process.env.STRIPE_CURRENCY || "usd").toLowerCase();
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CheckoutRequestBody;

    if (!body.slug || !body.audience) {
      return NextResponse.json(
        { message: "No pudimos preparar el pago para este onboarding." },
        { status: 400 },
      );
    }

    if (body.audience !== "client" && body.audience !== "prospect") {
      return NextResponse.json(
        { message: "La vista publica no es valida para pago." },
        { status: 400 },
      );
    }

    const purchaseKind = body.purchaseKind === "extra_package" ? "extra_package" : "plan";

    if (purchaseKind === "extra_package" && body.audience !== "client") {
      return NextResponse.json(
        { message: "Solo la vista publica del cliente puede comprar paquetes extra." },
        { status: 400 },
      );
    }

    if (body.audience === "prospect") {
      const proposal = await getSalesProposalBySlug(body.slug);

      if (!proposal) {
        return NextResponse.json(
          { message: "No encontramos la propuesta para preparar el pago." },
          { status: 404 },
        );
      }

      const activationResult = await activateSalesProposal(request, proposal);

      if ("proposal" in activationResult && activationResult.proposal) {
        const snapshot = buildPublicProspectSnapshotBase(activationResult.proposal);

        return NextResponse.json({
          config: snapshot.config,
          billing: snapshot.billing,
          prospectProposal: snapshot.prospectProposal,
          message: activationResult.message,
        });
      }

      const url = activationResult.url;
      if (!url) {
        throw new Error("No pudimos preparar la activacion del prospecto.");
      }

      return NextResponse.json({ url });
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = (await supabase.rpc("get_public_onboarding_snapshot", {
      p_slug: body.slug,
    })) as {
      data: PublicOnboardingRpcResponse | null;
      error: Error | null;
    };

    if (error || !data) {
      return NextResponse.json(
        { message: "No encontramos el onboarding para preparar el pago." },
        { status: 404 },
      );
    }

    const amount =
      purchaseKind === "extra_package"
        ? PUBLIC_EXTRA_CREDIT_PACKAGE.price
        : Number(
            data.config.custom_plan_price ??
              suggestPlanPrice(data.config.custom_plan_credits ?? data.config.base_capacity),
          );
    const amountInCents = Math.round(amount * 100);
    const periodMonths = data.config.custom_plan_period_months ?? 1;
    const usesSubscription =
      purchaseKind === "plan" && data.config.custom_plan_billing_mode !== "one_time";

    if (!Number.isFinite(amountInCents) || amountInCents <= 0) {
      return NextResponse.json(
        { message: "Este onboarding no tiene un monto valido para pagar." },
        { status: 400 },
      );
    }

    const origin = resolveOrigin(request);
    const checkoutUrl = `${origin}/public/${body.audience}/${body.slug}`;
    const stripe = getStripe();
    const metadata = {
      client_id: data.client.id,
      client_slug: data.client.slug,
      audience: body.audience,
      purchase_kind:
        purchaseKind === "extra_package"
          ? EXTRA_CREDIT_PACKAGE_PURCHASE_KIND
          : "plan",
      billing_kind: usesSubscription ? "subscription" : "one_time",
      period_months: String(periodMonths),
      extra_capacity_credits:
        purchaseKind === "extra_package"
          ? String(PUBLIC_EXTRA_CREDIT_PACKAGE.credits)
          : "0",
    };
    const productName =
      purchaseKind === "extra_package"
        ? `Paquete extra de ${PUBLIC_EXTRA_CREDIT_PACKAGE.credits} creditos - ${data.client.name}`
        : usesSubscription
          ? `Membresia Onboarding ${getPlanPeriodLabel(periodMonths)} - ${data.client.name}`
          : `Onboarding - ${data.client.name}`;
    const productDescription =
      purchaseKind === "extra_package"
        ? "Compra adicional de creditos para ampliar la capacidad operativa del onboarding."
        : data.client.description ||
          (usesSubscription
            ? "Membresia recurrente de onboarding y acompanamiento operativo."
            : "Plan de onboarding y acompanamiento operativo.");
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: usesSubscription ? "subscription" : "payment",
      submit_type: usesSubscription ? "subscribe" : "pay",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: resolveCurrency(),
            unit_amount: amountInCents,
            ...(usesSubscription
              ? {
                  recurring: {
                    interval: "month" as const,
                    interval_count: periodMonths,
                  },
                }
              : {}),
            product_data: {
              name: productName,
              description: productDescription,
            },
          },
        },
      ],
      metadata,
      success_url: `${checkoutUrl}?payment=success&session_id={CHECKOUT_SESSION_ID}${
        purchaseKind === "extra_package" ? "&purchase=extra_capacity" : ""
      }`,
      cancel_url: `${checkoutUrl}?payment=cancelled${
        purchaseKind === "extra_package" ? "&purchase=extra_capacity" : ""
      }`,
    };

    if (usesSubscription) {
      sessionParams.subscription_data = {
        description: productDescription,
        metadata,
      };
    } else {
      sessionParams.payment_intent_data = {
        metadata,
      };
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    if (!session.url) {
      return NextResponse.json(
        { message: "No pudimos crear el enlace de pago." },
        { status: 500 },
      );
    }

    return NextResponse.json({ url: session.url });
  } catch (caughtError) {
    return NextResponse.json(
      {
        message: formatUserError(
          caughtError,
          "No pudimos iniciar el pago. Intenta de nuevo en unos minutos.",
        ),
      },
      { status: 500 },
    );
  }
}
