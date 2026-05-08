import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { formatUserError, safeParseNumber } from "@/lib/utils";

type GroupRouteProps = {
  params: Promise<{ groupId: string }>;
};

export async function PUT(request: Request, { params }: GroupRouteProps) {
  try {
    const { groupId } = await params;
    const { supabase } = await requireUser();
    const body = (await request.json()) as {
      name?: string;
      description?: string | null;
      modalCategoryId?: string | null;
      modalCategory?: string | null;
      credits?: number;
      priorityStatus?: string | null;
      sortOrder?: number;
      isActive?: boolean;
      taskIds?: string[];
    };

    const name = body.name?.trim();
    const description = body.description?.trim() || null;
    const requestedModalCategoryId = body.modalCategoryId?.trim() || null;
    const requestedModalCategoryName = body.modalCategory?.trim() || null;
    const credits = Math.max(0, safeParseNumber(body.credits));
    const priorityStatus = body.priorityStatus === "prioritario" ? "prioritario" : "normal";
    const sortOrder = Number.isFinite(body.sortOrder) ? Number(body.sortOrder) : 0;
    const isActive = body.isActive ?? true;
    const taskIds = Array.isArray(body.taskIds)
      ? [...new Set(body.taskIds.map((taskId) => taskId.trim()).filter(Boolean))]
      : [];

    if (!name) {
      return NextResponse.json({ message: "El nombre del grupo es requerido." }, { status: 400 });
    }

    if (!taskIds.length && credits <= 0) {
      return NextResponse.json(
        { message: "Agrega tareas al grupo o define una cantidad de creditos mayor a cero." },
        { status: 400 },
      );
    }

    let selectedCategory: { id: string; name: string } | null = null;

    if (requestedModalCategoryId) {
      const { data: categoryRow, error: categoryError } = await supabase
        .from("credit_catalog_group_categories")
        .select("id, name")
        .eq("id", requestedModalCategoryId)
        .maybeSingle();

      if (categoryError) throw categoryError;
      if (!categoryRow) {
        return NextResponse.json({ message: "La categoria del grupo ya no existe." }, { status: 400 });
      }

      selectedCategory = categoryRow;
    } else if (requestedModalCategoryName) {
      const { data: categoryRow, error: categoryError } = await supabase
        .from("credit_catalog_group_categories")
        .select("id, name")
        .ilike("name", requestedModalCategoryName)
        .maybeSingle();

      if (categoryError) throw categoryError;
      selectedCategory = categoryRow;
    }

    const { data: currentGroup, error: currentError } = await supabase
      .from("credit_catalog_groups")
      .select("*")
      .eq("id", groupId)
      .single();

    if (currentError || !currentGroup) {
      return NextResponse.json({ message: "No encontramos el grupo." }, { status: 404 });
    }

    const { data, error } = await supabase
      .from("credit_catalog_groups")
      .update({
        name,
        description,
        modal_category: selectedCategory?.name ?? null,
        modal_category_id: selectedCategory?.id ?? null,
        credits,
        priority_status: priorityStatus,
        sort_order: sortOrder,
        is_active: isActive,
      })
      .eq("id", groupId)
      .select("*")
      .single();

    if (error || !data) throw error ?? new Error("No pudimos actualizar el grupo.");
    const { error: deleteLinksError } = await supabase
      .from("credit_catalog_group_items")
      .delete()
      .eq("group_id", groupId);

    if (deleteLinksError) {
      throw deleteLinksError;
    }

    if (taskIds.length) {
      const { error: insertLinksError } = await supabase.from("credit_catalog_group_items").insert(
        taskIds.map((taskId, index) => ({
          group_id: groupId,
          catalog_item_id: taskId,
          sort_order: index,
        })),
      );

      if (insertLinksError) {
        throw insertLinksError;
      }
    }

    return NextResponse.json(data);
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos actualizar el grupo.") },
      { status: 400 },
    );
  }
}

export async function DELETE(_: Request, { params }: GroupRouteProps) {
  try {
    const { groupId } = await params;
    const { supabase } = await requireUser();

    const { error: detachError } = await supabase
      .from("credit_catalog_group_items")
      .delete()
      .eq("group_id", groupId);

    if (detachError) throw detachError;

    const { error } = await supabase.from("credit_catalog_groups").delete().eq("id", groupId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos eliminar el grupo.") },
      { status: 400 },
    );
  }
}
