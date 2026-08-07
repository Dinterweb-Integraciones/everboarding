import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { canAccessAdminCatalogs } from "@/lib/platform-access";
import { formatUserError } from "@/lib/utils";

export async function POST(request: Request) {
  try {
    const { supabase, platformProfile } = await requireUser();
    if (!canAccessAdminCatalogs(platformProfile?.platform_role)) {
      return NextResponse.json(
        { message: "No tienes permisos para administrar el catálogo." },
        { status: 403 },
      );
    }

    const body = (await request.json()) as {
      name?: string;
      description?: string | null;
      isActive?: boolean;
    };

    const name = body.name?.trim();
    const description = body.description?.trim() || null;
    const isActive = body.isActive ?? true;

    if (!name) {
      return NextResponse.json(
        { message: "El nombre de la categoría es requerido." },
        { status: 400 },
      );
    }

    const { data, error } = await supabase
      .from("credit_catalog_use_case_categories")
      .insert({ name, description, is_active: isActive })
      .select("*")
      .single();

    if (error) throw error;

    return NextResponse.json(data);
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos crear la categoría de casos de uso.") },
      { status: 400 },
    );
  }
}
