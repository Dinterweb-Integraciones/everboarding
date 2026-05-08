import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { formatUserError, safeParseNumber } from "@/lib/utils";

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
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

    const { data, error } = await supabase
      .from("credit_catalog_groups")
      .insert({
        name,
        description,
        modal_category: selectedCategory?.name ?? null,
        modal_category_id: selectedCategory?.id ?? null,
        credits,
        priority_status: priorityStatus,
        sort_order: sortOrder,
        is_active: isActive,
        created_by_user_id: user.id,
      })
      .select("*")
      .single();

    if (error) throw error;

    if (taskIds.length) {
      const { error: linkError } = await supabase.from("credit_catalog_group_items").insert(
        taskIds.map((taskId, index) => ({
          group_id: data.id,
          catalog_item_id: taskId,
          sort_order: index,
        })),
      );

      if (linkError) {
        throw linkError;
      }
    }

    return NextResponse.json(data);
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos crear el grupo.") },
      { status: 400 },
    );
  }
}
