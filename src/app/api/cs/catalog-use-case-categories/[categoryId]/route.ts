import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { canAccessAdminCatalogs } from "@/lib/platform-access";
import { formatUserError } from "@/lib/utils";

type CategoryRouteProps = {
  params: Promise<{ categoryId: string }>;
};

export async function PUT(request: Request, { params }: CategoryRouteProps) {
  try {
    const { categoryId } = await params;
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
      .update({ name, description, is_active: isActive })
      .eq("id", categoryId)
      .select("*")
      .single();

    if (error || !data) {
      throw error ?? new Error("No pudimos actualizar la categoría de casos de uso.");
    }

    return NextResponse.json(data);
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos actualizar la categoría de casos de uso.") },
      { status: 400 },
    );
  }
}

export async function DELETE(_: Request, { params }: CategoryRouteProps) {
  try {
    const { categoryId } = await params;
    const { supabase, platformProfile } = await requireUser();
    if (!canAccessAdminCatalogs(platformProfile?.platform_role)) {
      return NextResponse.json(
        { message: "No tienes permisos para administrar el catálogo." },
        { status: 403 },
      );
    }

    const { data: usageRows, error: usageError } = await supabase
      .from("credit_catalog_groups")
      .select("id")
      .eq("use_case_category_id", categoryId)
      .limit(1);

    if (usageError) throw usageError;

    if ((usageRows ?? []).length > 0) {
      return NextResponse.json(
        { message: "No puedes eliminar una categoría que todavía tiene casos de uso asociados." },
        { status: 400 },
      );
    }

    const { error } = await supabase
      .from("credit_catalog_use_case_categories")
      .delete()
      .eq("id", categoryId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos eliminar la categoría de casos de uso.") },
      { status: 400 },
    );
  }
}
