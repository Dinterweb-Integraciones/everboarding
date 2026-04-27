import { NextResponse } from "next/server";
import Stripe from "stripe";

import {
  getPlanPeriodLabel,
  suggestPlanPrice,
  type OnboardingConfig,
  type PublicClientSummary,
  type PublicOnboardingAudience,
} from "@/lib/onboarding";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatUserError } from "@/lib/utils";

type CheckoutRequestBody = {
  audience?: PublicOnboardingAudience;
  slug?: string;
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

    const amount = Number(
      data.config.custom_plan_price ??
        suggestPlanPrice(data.config.custom_plan_credits ?? data.config.base_capacity),
    );
    const amountInCents = Math.round(amount * 100);
    const periodMonths = data.config.custom_plan_period_months ?? 1;
    const usesSubscription = data.config.custom_plan_billing_mode !== "one_time";

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
      billing_kind: usesSubscription ? "subscription" : "one_time",
      period_months: String(periodMonths),
    };
    const productName = usesSubscription
      ? `Membresia Onboarding ${getPlanPeriodLabel(periodMonths)} - ${data.client.name}`
      : `Onboarding - ${data.client.name}`;
    const productDescription =
      data.client.description ||
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
      success_url: `${checkoutUrl}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${checkoutUrl}?payment=cancelled`,
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
