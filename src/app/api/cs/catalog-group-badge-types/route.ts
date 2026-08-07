import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { canAccessAdminCatalogs } from "@/lib/platform-access";
import { formatUserError, safeParseNumber } from "@/lib/utils";

export async function POST(request: Request) {
  try {
    const { supabase, user, platformProfile } = await requireUser();
    if (!canAccessAdminCatalogs(platformProfile?.platform_role)) {
      return NextResponse.json(
        { message: "No tienes permisos para administrar keywords." },
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
      return NextResponse.json({ message: "El nombre de la keyword es requerido." }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("credit_catalog_group_badge_types")
      .insert({
        label,
        sort_order: sortOrder,
        is_active: isActive,
        created_by_user_id: user.id,
      })
      .select("*")
      .single();

    if (error) throw error;

    return NextResponse.json(data);
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos crear la keyword.") },
      { status: 400 },
    );
  }
}
