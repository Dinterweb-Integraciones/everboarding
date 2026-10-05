import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { isMonthKey, monthKeyToDate } from "@/lib/cs-monthly-goals";
import { canAccessAdminCatalogs } from "@/lib/platform-access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatUserError } from "@/lib/utils";

const MAX_GOAL_CREDITS = 1_000_000;

// Guarda (o borra, si goalCredits es null) la meta de créditos de un CS para un mes.
export async function PUT(request: Request) {
  try {
    const { user, platformProfile } = await requireUser("/cs/metas");

    if (!canAccessAdminCatalogs(platformProfile?.platform_role ?? null)) {
      return NextResponse.json(
        { message: "Solo admin o superadmin pueden definir las metas de Customer Success." },
        { status: 403 },
      );
    }

    const body = (await request.json()) as {
      customerSuccessId?: unknown;
      month?: unknown;
      goalCredits?: unknown;
    };

    if (typeof body.customerSuccessId !== "string" || !body.customerSuccessId) {
      return NextResponse.json({ message: "El Customer Success no es valido." }, { status: 400 });
    }

    if (!isMonthKey(body.month)) {
      return NextResponse.json({ message: "El mes no es valido." }, { status: 400 });
    }

    const goalCredits = body.goalCredits;
    if (
      goalCredits !== null &&
      (typeof goalCredits !== "number" ||
        !Number.isInteger(goalCredits) ||
        goalCredits < 0 ||
        goalCredits > MAX_GOAL_CREDITS)
    ) {
      return NextResponse.json(
        { message: "La meta debe ser un número entero de créditos, mayor o igual a 0." },
        { status: 400 },
      );
    }

    // customer_success_monthly_goals no está en database.ts (ver límite de complejidad de tipos).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createSupabaseAdminClient() as any;
    const month = monthKeyToDate(body.month);

    if (goalCredits === null) {
      const { error } = await admin
        .from("customer_success_monthly_goals")
        .delete()
        .eq("customer_success_id", body.customerSuccessId)
        .eq("month", month);

      if (error) throw error;

      return NextResponse.json({ goalCredits: null, message: "Meta eliminada." });
    }

    const { error } = await admin.from("customer_success_monthly_goals").upsert(
      {
        customer_success_id: body.customerSuccessId,
        month,
        goal_credits: goalCredits,
        updated_by_user_id: user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "customer_success_id,month" },
    );

    if (error) throw error;

    return NextResponse.json({ goalCredits, message: "Meta guardada." });
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos guardar la meta.") },
      { status: 400 },
    );
  }
}
