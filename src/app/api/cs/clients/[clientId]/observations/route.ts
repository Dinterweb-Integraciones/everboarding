import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { canManageClientAsStaff, isClientStaffRole } from "@/lib/client-staff-access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatUserError } from "@/lib/utils";

const MAX_OBSERVATIONS_LENGTH = 5000;

export async function PUT(
  request: Request,
  context: { params: Promise<{ clientId: string }> },
) {
  try {
    const { user, platformProfile } = await requireUser("/dashboard");
    const platformRole = platformProfile?.platform_role ?? null;

    if (!isClientStaffRole(platformRole)) {
      return NextResponse.json(
        { message: "Solo Customer Success puede editar las observaciones del cliente." },
        { status: 403 },
      );
    }

    const { clientId } = await context.params;
    const body = (await request.json()) as { observations?: unknown };

    if (!clientId) {
      return NextResponse.json({ message: "El cliente no es valido." }, { status: 400 });
    }

    if (typeof body.observations !== "string") {
      return NextResponse.json({ message: "Las observaciones no son validas." }, { status: 400 });
    }

    const observations = body.observations.trim();

    if (observations.length > MAX_OBSERVATIONS_LENGTH) {
      return NextResponse.json(
        { message: `Las observaciones no pueden superar ${MAX_OBSERVATIONS_LENGTH} caracteres.` },
        { status: 400 },
      );
    }

    const adminClient = createSupabaseAdminClient();

    if (!(await canManageClientAsStaff(adminClient, platformRole, user.id, clientId))) {
      return NextResponse.json(
        { message: "Solo puedes editar las observaciones de los clientes que atiendes." },
        { status: 403 },
      );
    }

    // clients.observations no está en database.ts (ver límite de complejidad de tipos).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = adminClient as any;
    const { data: savedRow, error: saveError } = await admin
      .from("clients")
      .update({ observations: observations || null })
      .eq("id", clientId)
      .select("observations")
      .single();

    if (saveError) throw saveError;

    return NextResponse.json({
      observations: (savedRow.observations as string | null) ?? "",
      message: "Observaciones guardadas.",
    });
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos guardar las observaciones.") },
      { status: 400 },
    );
  }
}
