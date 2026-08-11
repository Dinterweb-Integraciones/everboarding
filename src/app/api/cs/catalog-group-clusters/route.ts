import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { canAccessAdminCatalogs } from "@/lib/platform-access";
import { formatUserError, safeParseNumber } from "@/lib/utils";

export async function POST(request: Request) {
  try {
    const { supabase, user, platformProfile } = await requireUser();
    if (!canAccessAdminCatalogs(platformProfile?.platform_role)) {
      return NextResponse.json(
        { message: "No tienes permisos para administrar clusters." },
        { status: 403 },
      );
    }

    const body = (await request.json()) as {
      label?: string;
      sortOrder?: number | string;
      isActive?: boolean;
    };
    const label = body.label?.trim();
    const sortOrder = safeParseNumber(body.sortOrder ?? 0);
    const isActive = body.isActive ?? true;

    if (!label) {
      return NextResponse.json({ message: "El nombre del cluster es requerido." }, { status: 400 });
    }

    const { data: existingCluster, error: existingClusterError } = await supabase
      .from("credit_catalog_group_clusters")
      .select("id")
      .ilike("label", label)
      .limit(1)
      .maybeSingle();

    if (existingClusterError) throw existingClusterError;

    const mutation = existingCluster
      ? supabase
          .from("credit_catalog_group_clusters")
          .update({ label, sort_order: sortOrder, is_active: isActive })
          .eq("id", existingCluster.id)
      : supabase.from("credit_catalog_group_clusters").insert({
          label,
          sort_order: sortOrder,
          is_active: isActive,
          created_by_user_id: user.id,
        });

    const { data, error } = await mutation.select("*").single();
    if (error) throw error;

    return NextResponse.json(data);
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos crear el cluster.") },
      { status: 400 },
    );
  }
}
