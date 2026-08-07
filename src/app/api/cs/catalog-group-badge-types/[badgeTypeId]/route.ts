import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { canAccessAdminCatalogs } from "@/lib/platform-access";
import { formatUserError } from "@/lib/utils";

type BadgeTypeRouteProps = {
  params: Promise<{ badgeTypeId: string }>;
};

export async function DELETE(_: Request, { params }: BadgeTypeRouteProps) {
  try {
    const { badgeTypeId } = await params;
    const { supabase, platformProfile } = await requireUser();
    if (!canAccessAdminCatalogs(platformProfile?.platform_role)) {
      return NextResponse.json(
        { message: "No tienes permisos para administrar keywords." },
        { status: 403 },
      );
    }

    const { data: keyword, error: keywordError } = await supabase
      .from("credit_catalog_group_badge_types")
      .select("id, label")
      .eq("id", badgeTypeId)
      .maybeSingle();

    if (keywordError) throw keywordError;
    if (!keyword) {
      return NextResponse.json({ message: "La keyword ya no existe." }, { status: 404 });
    }

    const { data: usageRows, error: usageError } = await supabase
      .from("credit_catalog_groups")
      .select("id")
      .eq("display_badge", keyword.label)
      .limit(1);

    if (usageError) throw usageError;
    if ((usageRows ?? []).length > 0) {
      const { error: archiveError } = await supabase
        .from("credit_catalog_group_badge_types")
        .update({ is_active: false, is_legacy: true })
        .eq("id", badgeTypeId);

      if (archiveError) throw archiveError;

      return NextResponse.json({ success: true, disposition: "archived" });
    }

    const { error } = await supabase
      .from("credit_catalog_group_badge_types")
      .delete()
      .eq("id", badgeTypeId);

    if (error) throw error;

    return NextResponse.json({ success: true, disposition: "deleted" });
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos eliminar la keyword.") },
      { status: 400 },
    );
  }
}
