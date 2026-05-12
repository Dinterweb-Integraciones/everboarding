import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { formatUserError, safeParseNumber } from "@/lib/utils";

type CategoryRouteProps = {
  params: Promise<{ categoryId: string }>;
};

export async function PUT(request: Request, { params }: CategoryRouteProps) {
  try {
    const { categoryId } = await params;
    const { supabase } = await requireUser();
    const body = (await request.json()) as {
      name?: string;
      description?: string | null;
      sortOrder?: number | string;
      isActive?: boolean;
    };

    const name = body.name?.trim();
    const description = body.description?.trim() || null;
    const sortOrder = safeParseNumber(body.sortOrder ?? 0);
    const isActive = body.isActive ?? true;

    if (!name) {
      return NextResponse.json({ message: "El nombre de la categoria es requerido." }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("credit_catalog_group_categories")
      .update({
        name,
        description,
        sort_order: sortOrder,
        is_active: isActive,
      })
      .eq("id", categoryId)
      .select("*")
      .single();

    if (error || !data) {
      throw error ?? new Error("No pudimos actualizar la categoria de grupo.");
    }

    return NextResponse.json(data);
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos actualizar la categoria de grupo.") },
      { status: 400 },
    );
  }
}

export async function DELETE(_: Request, { params }: CategoryRouteProps) {
  try {
    const { categoryId } = await params;
    const { supabase } = await requireUser();

    const { data: usageRows, error: usageError } = await supabase
      .from("credit_catalog_groups")
      .select("id")
      .eq("modal_category_id", categoryId)
      .limit(1);

    if (usageError) throw usageError;

    if ((usageRows ?? []).length > 0) {
      return NextResponse.json(
        { message: "No puedes eliminar una categoria que todavia tiene grupos asociados." },
        { status: 400 },
      );
    }

    const { error } = await supabase
      .from("credit_catalog_group_categories")
      .delete()
      .eq("id", categoryId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos eliminar la categoria de grupo.") },
      { status: 400 },
    );
  }
}
