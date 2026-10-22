import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { canManagePlatformUsers } from "@/lib/platform-access";
import { saveRecurrenceOffer } from "@/lib/membership-checkout";
import type { PlanPeriodMonths } from "@/lib/onboarding";
import type { RecurrenceOffer } from "@/lib/recurrence-offer";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatUserError, safeParseNumber } from "@/lib/utils";

type RecurrenceOfferBody = {
  credits?: unknown;
  periodMonths?: unknown;
  price?: unknown;
  creditSavingsPercent?: unknown;
  flowCredits?: unknown;
  creditValidityDays?: unknown;
};

const PERIOD_MONTHS = new Set([1, 3, 6, 12]);

// Guarda la oferta de recurrencia de un cliente de paquetes: su cambio de forma de cobro pendiente
// en client_billing_mode_changes. Solo superadmin. No cambia nada del cliente: es lo que se le
// ofrece en su vista pública ("Únete a Everboarding"); pasa a recurrencia cuando paga la membresía
// en Stripe (activateRecurrenceFromPayment).
export async function PUT(
  request: Request,
  context: { params: Promise<{ clientId: string }> },
) {
  try {
    const { user, platformProfile } = await requireUser("/dashboard");

    if (!canManagePlatformUsers(platformProfile?.platform_role ?? null)) {
      return NextResponse.json(
        { message: "Solo un superadmin puede configurar la recurrencia de un cliente." },
        { status: 403 },
      );
    }

    const { clientId } = await context.params;
    const body = (await request.json()) as RecurrenceOfferBody;
    const credits = Math.floor(safeParseNumber(body.credits as number));
    const periodMonths = safeParseNumber(body.periodMonths as number);
    const price = safeParseNumber(body.price as number);
    const creditSavingsPercent = safeParseNumber(body.creditSavingsPercent as number);
    const flowCredits =
      body.flowCredits === null || body.flowCredits === undefined || body.flowCredits === ""
        ? null
        : Math.max(0, Math.floor(safeParseNumber(body.flowCredits as number)));
    const creditValidityDays = Math.floor(safeParseNumber(body.creditValidityDays as number));

    if (!clientId) {
      return NextResponse.json({ message: "El cliente no es valido." }, { status: 400 });
    }
    if (credits <= 0) {
      return NextResponse.json({ message: "Ingresa los créditos contratados." }, { status: 400 });
    }
    if (!PERIOD_MONTHS.has(periodMonths)) {
      return NextResponse.json({ message: "Selecciona un periodo valido." }, { status: 400 });
    }
    if (price <= 0) {
      return NextResponse.json({ message: "Ingresa el precio por periodo." }, { status: 400 });
    }
    if (creditSavingsPercent < 0 || creditSavingsPercent >= 100) {
      return NextResponse.json(
        { message: "El ahorro en créditos debe estar entre 0% y 99%." },
        { status: 400 },
      );
    }
    if (creditValidityDays <= 0) {
      return NextResponse.json({ message: "Ingresa la vigencia de los créditos." }, { status: 400 });
    }

    // onboarding_configs se lee sin tipos (ver límite de complejidad de tipos).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createSupabaseAdminClient() as any;
    const { data: config, error: configError } = await admin
      .from("onboarding_configs")
      .select("custom_plan_billing_mode")
      .eq("client_id", clientId)
      .maybeSingle();

    if (configError) throw configError;

    if (!config) {
      return NextResponse.json({ message: "El cliente no tiene configuración de plan." }, { status: 400 });
    }
    if (config.custom_plan_billing_mode !== "one_time") {
      return NextResponse.json({ message: "El cliente ya es de recurrencia." }, { status: 400 });
    }

    const offer: RecurrenceOffer = {
      credits,
      periodMonths: periodMonths as PlanPeriodMonths,
      price,
      creditSavingsPercent,
      flowCredits,
      creditValidityDays,
    };

    await saveRecurrenceOffer(clientId, offer, user.id);

    return NextResponse.json({
      offer,
      message:
        "Oferta de recurrencia guardada. El cliente la verá en su vista pública y pasará a recurrencia cuando pague.",
    });
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos guardar la oferta de recurrencia.") },
      { status: 400 },
    );
  }
}
