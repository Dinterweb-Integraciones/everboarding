import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { getMonthlyContractCredits, type PlanPeriodMonths } from "@/lib/onboarding";
import { canManagePlatformUsers } from "@/lib/platform-access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatUserError, safeParseNumber, toIsoDate } from "@/lib/utils";

type ConvertToSubscriptionBody = {
  credits?: unknown;
  periodMonths?: unknown;
  price?: unknown;
  flowCredits?: unknown;
  creditValidityDays?: unknown;
  firstCycleStartDate?: unknown;
  paymentMethod?: unknown;
};

const PERIOD_MONTHS = new Set([1, 3, 6, 12]);

// Pasa un cliente de paquetes (one_time) a recurrencia (subscription). Solo superadmin.
// Actualiza la configuración del plan y la venta ligada (de la que dependen las renovaciones por
// transferencia), y registra el cambio. No toca los ciclos ni los grants del paquete: su saldo
// sigue vigente hasta su vencimiento original. El primer ciclo se cobra después:
//   Stripe: con el link de membresía; el ciclo empieza el día del pago, que queda como día de corte
//     (anchorAwaitingMembershipToPaymentDate).
//   Transferencia: desde la cola de Finanzas a partir de firstCycleStartDate, que queda como día de
//     corte (onboarding_configs.start_date).
export async function PUT(
  request: Request,
  context: { params: Promise<{ clientId: string }> },
) {
  try {
    const { user, platformProfile } = await requireUser("/dashboard");

    if (!canManagePlatformUsers(platformProfile?.platform_role ?? null)) {
      return NextResponse.json(
        { message: "Solo un superadmin puede cambiar la forma de cobro de un cliente." },
        { status: 403 },
      );
    }

    const { clientId } = await context.params;
    const body = (await request.json()) as ConvertToSubscriptionBody;
    const credits = Math.floor(safeParseNumber(body.credits as number));
    const periodMonths = safeParseNumber(body.periodMonths as number);
    const price = safeParseNumber(body.price as number);
    const flowCredits =
      body.flowCredits === null || body.flowCredits === undefined || body.flowCredits === ""
        ? null
        : Math.max(0, Math.floor(safeParseNumber(body.flowCredits as number)));
    const creditValidityDays = Math.floor(safeParseNumber(body.creditValidityDays as number));
    const paymentMethod = body.paymentMethod;
    // Solo con transferencia: con Stripe el primer ciclo empieza el día del pago.
    const firstCycleStartDate =
      paymentMethod === "bank_transfer" && typeof body.firstCycleStartDate === "string"
        ? body.firstCycleStartDate.trim()
        : null;
    const todayIsoDate = toIsoDate();

    if (!clientId) {
      return NextResponse.json({ message: "El cliente no es valido." }, { status: 400 });
    }
    if (credits <= 0) {
      return NextResponse.json({ message: "Ingresa los créditos contratados." }, { status: 400 });
    }
    if (!PERIOD_MONTHS.has(periodMonths)) {
      return NextResponse.json({ message: "Selecciona un periodo valido." }, { status: 400 });
    }
    if (price < 0) {
      return NextResponse.json({ message: "El precio no puede ser negativo." }, { status: 400 });
    }
    if (creditValidityDays <= 0) {
      return NextResponse.json({ message: "Ingresa la vigencia de los créditos." }, { status: 400 });
    }
    if (paymentMethod !== "stripe" && paymentMethod !== "bank_transfer") {
      return NextResponse.json({ message: "Selecciona cómo se va a cobrar." }, { status: 400 });
    }
    if (paymentMethod === "bank_transfer" && !/^\d{4}-\d{2}-\d{2}$/.test(firstCycleStartDate ?? "")) {
      return NextResponse.json({ message: "Selecciona la fecha del primer ciclo." }, { status: 400 });
    }
    if (firstCycleStartDate && firstCycleStartDate < todayIsoDate) {
      return NextResponse.json(
        { message: "El primer ciclo no puede empezar antes de hoy." },
        { status: 400 },
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createSupabaseAdminClient() as any;
    const [
      { data: config, error: configError },
      { data: latestCycle, error: cycleError },
      { data: proposal, error: proposalError },
    ] = await Promise.all([
      admin.from("onboarding_configs").select("*").eq("client_id", clientId).maybeSingle(),
      admin
        .from("client_billing_cycles")
        .select("cycle_start_date")
        .eq("client_id", clientId)
        .eq("status", "paid")
        .order("cycle_start_date", { ascending: false })
        .limit(1)
        .maybeSingle(),
      // Venta con la que se activó el cliente; si hay varias, la más reciente.
      admin
        .from("sales_proposals")
        .select("id, status")
        .eq("activated_client_id", clientId)
        .order("activated_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (configError) throw configError;
    if (cycleError) throw cycleError;
    if (proposalError) throw proposalError;

    if (!config) {
      return NextResponse.json({ message: "El cliente no tiene configuración de plan." }, { status: 400 });
    }
    if (config.custom_plan_billing_mode !== "one_time") {
      return NextResponse.json({ message: "El cliente ya es de recurrencia." }, { status: 400 });
    }
    // El ciclo nuevo no puede compartir fecha de inicio con el del paquete: el pago lo
    // sobrescribiría (client_billing_cycles es único por cliente y fecha de inicio).
    if (firstCycleStartDate && latestCycle && firstCycleStartDate <= latestCycle.cycle_start_date) {
      return NextResponse.json(
        { message: "El primer ciclo debe empezar después del inicio del último paquete pagado." },
        { status: 400 },
      );
    }
    if (paymentMethod === "bank_transfer" && (!proposal || proposal.status !== "board_activated")) {
      return NextResponse.json(
        {
          message:
            "El cobro por transferencia necesita una venta activada ligada al cliente; usa Stripe o activa la venta primero.",
        },
        { status: 400 },
      );
    }

    const updatedAt = new Date().toISOString();
    const typedPeriodMonths = periodMonths as PlanPeriodMonths;
    const monthlyCredits = getMonthlyContractCredits({
      base_capacity: credits,
      custom_plan_credits: credits,
      custom_plan_period_months: typedPeriodMonths,
    });

    // Se registra primero: si el registro falla, no se cambia nada.
    // client_billing_mode_changes no está en database.ts (ver límite de complejidad de tipos).
    const { error: logError } = await admin.from("client_billing_mode_changes").insert({
      client_id: clientId,
      from_mode: "one_time",
      to_mode: "subscription",
      payment_method: paymentMethod,
      first_cycle_start_date: firstCycleStartDate,
      details: {
        credits,
        periodMonths: typedPeriodMonths,
        price,
        flowCredits,
        creditValidityDays,
        salesProposalId: proposal?.id ?? null,
      },
      changed_by_user_id: user.id,
    });

    if (logError) throw logError;

    if (proposal) {
      const { error: proposalUpdateError } = await admin
        .from("sales_proposals")
        .update({
          billing_mode: "subscription",
          payment_method: paymentMethod,
          plan_period_months: typedPeriodMonths,
          contracted_credits: credits,
          quoted_price: price,
          flow_credits: flowCredits,
          credit_validity_days: creditValidityDays,
          // Las renovaciones por transferencia empiezan aquí (ver finance-transfer-payments).
          ...(firstCycleStartDate ? { start_date: firstCycleStartDate } : {}),
          updated_at: updatedAt,
        })
        .eq("id", proposal.id);

      if (proposalUpdateError) throw proposalUpdateError;
    }

    const { data: updatedConfig, error: configUpdateError } = await admin
      .from("onboarding_configs")
      .update({
        custom_plan_billing_mode: "subscription",
        custom_plan_type: "mensual",
        custom_plan_period_months: typedPeriodMonths,
        custom_plan_credits: credits,
        base_capacity: monthlyCredits,
        custom_plan_price: price,
        flow_credits: flowCredits,
        credit_validity_days: creditValidityDays,
        // Día de corte de los ciclos mensuales (get_client_cycle_window). Con Stripe se fija al pagar.
        ...(firstCycleStartDate ? { start_date: firstCycleStartDate } : {}),
        updated_at: updatedAt,
      })
      .eq("client_id", clientId)
      .select("*")
      .single();

    if (configUpdateError) throw configUpdateError;

    return NextResponse.json({
      config: updatedConfig,
      message:
        paymentMethod === "stripe"
          ? "Cliente pasado a recurrencia. Copia el link de membresía y envíalo al cliente; su ciclo empieza el día que pague."
          : "Cliente pasado a recurrencia. Finanzas verá el primer cobro por transferencia en la fecha del primer ciclo.",
    });
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos cambiar la forma de cobro del cliente.") },
      { status: 400 },
    );
  }
}
