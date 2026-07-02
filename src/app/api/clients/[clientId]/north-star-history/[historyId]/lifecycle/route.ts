import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatUserError } from "@/lib/utils";
import type { NorthStarLifecycleStatus } from "@/lib/onboarding";

const lifecycleStatuses = new Set<NorthStarLifecycleStatus>(["active", "inactive", "fulfilled"]);

function isLifecycleStatus(value: unknown): value is NorthStarLifecycleStatus {
  return typeof value === "string" && lifecycleStatuses.has(value as NorthStarLifecycleStatus);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ clientId: string; historyId: string }> },
) {
  try {
    const { user, platformProfile } = await requireUser();
    const { clientId, historyId } = await context.params;
    const body = (await request.json()) as { status?: unknown };

    if (!clientId || !historyId) {
      return NextResponse.json({ message: "El Norte no es valido." }, { status: 400 });
    }

    if (!isLifecycleStatus(body.status)) {
      return NextResponse.json({ message: "Selecciona un estado valido." }, { status: 400 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createSupabaseAdminClient() as any;
    const { data: historyRow, error: historyError } = await admin
      .from("onboarding_north_star_history")
      .select("id, client_id, created_at")
      .eq("id", historyId)
      .eq("client_id", clientId)
      .single();

    if (historyError) throw historyError;

    const canManageByPlatform =
      platformProfile?.platform_role === "admin" || platformProfile?.platform_role === "superadmin";

    const { data: clientRow, error: clientError } = await admin
      .from("clients")
      .select("id, owner_user_id, seller_user_id, csm_user_id")
      .eq("id", clientId)
      .single();

    if (clientError) throw clientError;

    const canManageByAssignment =
      clientRow.owner_user_id === user.id ||
      clientRow.seller_user_id === user.id ||
      clientRow.csm_user_id === user.id;

    const { data: membershipRow, error: membershipError } = await admin
      .from("client_members")
      .select("access_role")
      .eq("client_id", clientId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipError) throw membershipError;

    const canManageByMembership =
      membershipRow?.access_role === "editor" || membershipRow?.access_role === "owner";

    if (!canManageByPlatform && !canManageByAssignment && !canManageByMembership) {
      return NextResponse.json(
        { message: "No tienes permiso para cambiar el estado de este Norte." },
        { status: 403 },
      );
    }

    if (body.status === "active") {
      const { error: deactivateError } = await admin
        .from("onboarding_north_star_history")
        .update({ north_star_lifecycle_status: "inactive" })
        .eq("client_id", clientId)
        .eq("north_star_lifecycle_status", "active");

      if (deactivateError) throw deactivateError;
    }

    const { data: updatedHistoryRow, error: updateError } = await admin
      .from("onboarding_north_star_history")
      .update({ north_star_lifecycle_status: body.status })
      .eq("id", historyRow.id)
      .select("*")
      .single();

    if (updateError) throw updateError;

    const { data: latestHistoryRow, error: latestHistoryError } = await admin
      .from("onboarding_north_star_history")
      .select("id")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestHistoryError) throw latestHistoryError;

    if (latestHistoryRow?.id === historyRow.id) {
      const { error: configError } = await admin
        .from("onboarding_configs")
        .update({ north_star_lifecycle_status: body.status })
        .eq("client_id", clientId);

      if (configError) throw configError;
    }

    return NextResponse.json(updatedHistoryRow);
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos actualizar el estado del Norte.") },
      { status: 500 },
    );
  }
}
