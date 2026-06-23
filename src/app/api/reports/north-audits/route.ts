import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { formatUserError } from "@/lib/utils";

export async function PATCH(request: Request) {
  try {
    const { supabase, user, platformProfile } = await requireUser();
    if (platformProfile?.platform_role !== "admin" && platformProfile?.platform_role !== "superadmin") {
      return NextResponse.json({ message: "No tienes permiso para auditar Nortes." }, { status: 403 });
    }

    const body = (await request.json()) as {
      northStarHistoryId?: string;
      isFrom?: boolean;
      isUntil?: boolean;
      isTimed?: boolean;
      isCrucial?: boolean;
      hasAssociatedUseCases?: boolean;
      notes?: string;
    };
    if (!body.northStarHistoryId) {
      return NextResponse.json({ message: "Falta el Norte a auditar." }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("north_star_audits" as never)
      .upsert({
        north_star_history_id: body.northStarHistoryId,
        is_from: Boolean(body.isFrom),
        is_until: Boolean(body.isUntil),
        is_timed: Boolean(body.isTimed),
        is_crucial: Boolean(body.isCrucial),
        has_associated_use_cases: Boolean(body.hasAssociatedUseCases),
        notes: body.notes?.trim() ?? "",
        updated_by_user_id: user.id,
      } as never, { onConflict: "north_star_history_id" })
      .select("*")
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ message: formatUserError(error, "No pudimos guardar la auditoría.") }, { status: 500 });
  }
}
