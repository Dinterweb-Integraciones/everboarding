import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { canAccessAdminCatalogs } from "@/lib/platform-access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatUserError } from "@/lib/utils";

export async function PUT(
  request: Request,
  context: { params: Promise<{ clientId: string }> },
) {
  try {
    const { platformProfile } = await requireUser("/cs/clientes");

    if (!canAccessAdminCatalogs(platformProfile?.platform_role ?? null)) {
      return NextResponse.json(
        { message: "Solo administradores pueden cambiar el estado de clientes." },
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createSupabaseAdminClient() as any;
    const { data: updatedClient, error: updateError } = await admin
      .from("clients")
      .update({ is_active: body.isActive })
      .eq("id", clientId)
      .select("*")
      .single();

    if (updateError) throw updateError;

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
