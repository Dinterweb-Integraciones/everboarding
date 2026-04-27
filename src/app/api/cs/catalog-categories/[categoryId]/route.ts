import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { formatUserError } from "@/lib/utils";

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
      isActive?: boolean;
    };

    const name = body.name?.trim();
    const description = body.description?.trim() || null;
    const isActive = body.isActive ?? true;

    if (!name) {
      return NextResponse.json({ message: "El nombre de la categoría es requerido." }, { status: 400 });
    }

    const { data: currentCategory, error: currentError } = await supabase
      .from("credit_catalog_categories")
      .select("*")
      .eq("id", categoryId)
      .single();

    if (currentError || !currentCategory) {
      return NextResponse.json({ message: "No encontramos la categoría." }, { status: 404 });
    }

    const { data, error } = await supabase
      .from("credit_catalog_categories")
      .update({
        name,
        description,
        is_active: isActive,
      })
      .eq("id", categoryId)
      .select("*")
      .single();

    if (error || !data) throw error ?? new Error("No pudimos actualizar la categoría.");

    if (currentCategory.name !== name) {
      const { error: tasksError } = await supabase
        .from("credit_catalog_items")
        .update({ category: name })
        .eq("category", currentCategory.name);

      if (tasksError) throw tasksError;
    }

    return NextResponse.json(data);
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos actualizar la categoría.") },
      { status: 400 },
    );
  }
}

export async function DELETE(_: Request, { params }: CategoryRouteProps) {
  try {
    const { categoryId } = await params;
    const { supabase } = await requireUser();

    const { data: currentCategory, error: currentError } = await supabase
      .from("credit_catalog_categories")
      .select("*")
      .eq("id", categoryId)
      .single();

    if (currentError || !currentCategory) {
      return NextResponse.json({ message: "No encontramos la categoría." }, { status: 404 });
    }

    const { data: usageRows, error: usageError } = await supabase
      .from("credit_catalog_items")
      .select("id")
      .eq("category", currentCategory.name)
      .limit(1);

    if (usageError) throw usageError;

    if ((usageRows ?? []).length > 0) {
      return NextResponse.json(
        { message: "No puedes eliminar una categoría que todavía tiene tareas asociadas." },
        { status: 400 },
      );
    }

    const { error } = await supabase.from("credit_catalog_categories").delete().eq("id", categoryId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos eliminar la categoría.") },
      { status: 400 },
    );
  }
}
