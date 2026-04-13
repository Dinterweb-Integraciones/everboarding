import { NextResponse } from "next/server";
import Stripe from "stripe";

import {
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
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    request.headers.get("origin") ||
    new URL(request.url).origin
  ).replace(/\/$/, "");
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

    if (!Number.isFinite(amountInCents) || amountInCents <= 0) {
      return NextResponse.json(
        { message: "Este onboarding no tiene un monto valido para pagar." },
        { status: 400 },
      );
    }

    const origin = resolveOrigin(request);
    const checkoutUrl = `${origin}/public/${body.audience}/${body.slug}`;
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      submit_type: "pay",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: resolveCurrency(),
            unit_amount: amountInCents,
            product_data: {
              name: `Onboarding - ${data.client.name}`,
              description:
                data.client.description || "Plan de onboarding y acompañamiento operativo.",
            },
          },
        },
      ],
      metadata: {
        client_id: data.client.id,
        client_slug: data.client.slug,
        audience: body.audience,
      },
      success_url: `${checkoutUrl}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${checkoutUrl}?payment=cancelled`,
    });

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
