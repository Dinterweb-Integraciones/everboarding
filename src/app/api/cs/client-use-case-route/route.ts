import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { canViewPrivateCatalogGroups } from "@/lib/platform-access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatUserError } from "@/lib/utils";

type RouteItemInput = { groupId: string; icon: string | null };

export async function PUT(request: Request) {
  try {
    const { user, platformProfile } = await requireUser("/cs/mapa-cliente");

    if (!canViewPrivateCatalogGroups(platformProfile?.platform_role ?? null)) {
      return NextResponse.json(
        { message: "No tienes permiso para editar el mapa del cliente." },
        { status: 403 },
      );
    }

    const body = (await request.json()) as {
      clientId?: unknown;
      items?: unknown;
    };

    if (typeof body.clientId !== "string" || !body.clientId) {
      return NextResponse.json({ message: "Selecciona un cliente válido." }, { status: 400 });
    }

    const isValidItem = (item: unknown): item is RouteItemInput =>
      typeof item === "object"
      && item !== null
      && typeof (item as { groupId?: unknown }).groupId === "string"
      && ((item as { icon?: unknown }).icon === null || typeof (item as { icon?: unknown }).icon === "string");

    if (!Array.isArray(body.items) || !body.items.every(isValidItem)) {
      return NextResponse.json({ message: "Selecciona un mapa de casos válido." }, { status: 400 });
    }

    const items = body.items as RouteItemInput[];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createSupabaseAdminClient() as any;

    const { error: deleteError } = await admin
      .from("client_use_case_routes")
      .delete()
      .eq("client_id", body.clientId);

    if (deleteError) throw deleteError;

    if (items.length === 0) {
      return NextResponse.json({ routes: [] });
    }

    const { data: routes, error: insertError } = await admin
      .from("client_use_case_routes")
      .insert(
        items.map((item, index) => ({
          client_id: body.clientId,
          group_id: item.groupId,
          position: index,
          icon: item.icon || null,
          updated_by_user_id: user.id,
        })),
      )
      .select("*");

    if (insertError) throw insertError;

    return NextResponse.json({ routes });
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos guardar el mapa del cliente.") },
      { status: 400 },
    );
  }
}
