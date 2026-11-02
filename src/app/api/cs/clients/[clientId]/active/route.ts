import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { canManageClientAsStaff, isClientStaffRole } from "@/lib/client-staff-access";
import { invalidateReportsCache } from "@/lib/reports-cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatUserError } from "@/lib/utils";

export async function PUT(
  request: Request,
  context: { params: Promise<{ clientId: string }> },
) {
  try {
    const { user, platformProfile } = await requireUser("/cs/clientes");
    const platformRole = platformProfile?.platform_role ?? null;

    if (!isClientStaffRole(platformRole)) {
      return NextResponse.json(
        { message: "Solo administradores y Customer Success pueden cambiar el estado de clientes." },
        { status: 403 },
      );
    }

    const { clientId } = await context.params;
    const body = (await request.json()) as { isActive?: unknown };

    if (!clientId) {
      return NextResponse.json({ message: "El cliente no es valido." }, { status: 400 });
    }

    if (typeof body.isActive !== "boolean") {
      return NextResponse.json({ message: "Selecciona un estado valido." }, { status: 400 });
    }

    const adminClient = createSupabaseAdminClient();

    if (!(await canManageClientAsStaff(adminClient, platformRole, user.id, clientId))) {
      return NextResponse.json(
        { message: "Solo puedes cambiar el estado de los clientes que atiendes." },
        { status: 403 },
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = adminClient as any;
    const { data: updatedClient, error: updateError } = await admin
      .from("clients")
      .update({ is_active: body.isActive })
      .eq("id", clientId)
      .select("*")
      .single();

    if (updateError) throw updateError;
    invalidateReportsCache();

    return NextResponse.json({
      ...updatedClient,
      message: body.isActive ? "Cliente activado correctamente." : "Cliente pausado correctamente.",
    });
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos actualizar el estado del cliente.") },
      { status: 400 },
    );
  }
}
