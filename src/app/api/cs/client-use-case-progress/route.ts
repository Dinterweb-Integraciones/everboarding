import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { canViewPrivateCatalogGroups } from "@/lib/platform-access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatUserError } from "@/lib/utils";

export async function PUT(request: Request) {
  try {
    const { user, platformProfile } = await requireUser("/cs/mapa-cliente");

    if (!canViewPrivateCatalogGroups(platformProfile?.platform_role ?? null)) {
      return NextResponse.json(
        { message: "No tienes permiso para editar el mapa de casos del cliente." },
        { status: 403 },
      );
    }

    const body = (await request.json()) as {
      clientId?: unknown;
      groupId?: unknown;
      isCompleted?: unknown;
    };

    if (typeof body.clientId !== "string" || !body.clientId) {
      return NextResponse.json({ message: "Selecciona un cliente válido." }, { status: 400 });
    }

    if (typeof body.groupId !== "string" || !body.groupId) {
      return NextResponse.json({ message: "Selecciona un caso de uso válido." }, { status: 400 });
    }

    if (typeof body.isCompleted !== "boolean") {
      return NextResponse.json({ message: "Selecciona un estado válido." }, { status: 400 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createSupabaseAdminClient() as any;
    const { data: progress, error: upsertError } = await admin
      .from("client_use_case_progress")
      .upsert(
        {
          client_id: body.clientId,
          group_id: body.groupId,
          is_completed: body.isCompleted,
          updated_by_user_id: user.id,
        },
        { onConflict: "client_id,group_id" },
      )
      .select("*")
      .single();

    if (upsertError) throw upsertError;

    return NextResponse.json(progress);
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos actualizar el progreso del caso de uso.") },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const { platformProfile } = await requireUser("/cs/mapa-cliente");

    if (!canViewPrivateCatalogGroups(platformProfile?.platform_role ?? null)) {
      return NextResponse.json(
        { message: "No tienes permiso para editar el mapa de casos del cliente." },
        { status: 403 },
      );
    }

    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId");
    const groupId = searchParams.get("groupId");

    if (!clientId) {
      return NextResponse.json({ message: "Selecciona un cliente válido." }, { status: 400 });
    }

    if (!groupId) {
      return NextResponse.json({ message: "Selecciona un caso de uso válido." }, { status: 400 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createSupabaseAdminClient() as any;
    const { error: deleteError } = await admin
      .from("client_use_case_progress")
      .delete()
      .eq("client_id", clientId)
      .eq("group_id", groupId);

    if (deleteError) throw deleteError;

    return NextResponse.json({ success: true });
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos quitar el caso de uso del mapa.") },
      { status: 400 },
    );
  }
}
