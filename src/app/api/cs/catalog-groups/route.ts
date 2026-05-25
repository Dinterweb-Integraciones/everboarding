import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { formatUserError, safeParseNumber } from "@/lib/utils";

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = (await request.json()) as {
      name?: string;
      description?: string | null;
      modalCategoryIds?: string[] | null;
      modalCategoryId?: string | null;
      modalCategory?: string | null;
      credits?: number;
      priorityStatus?: string | null;
      sortOrder?: number;
      isActive?: boolean;
      taskIds?: string[];
      tags?: string[] | null;
    };

    const name = body.name?.trim();
    const description = body.description?.trim() || null;
    const requestedModalCategoryIds = Array.isArray(body.modalCategoryIds)
      ? [...new Set(body.modalCategoryIds.map((categoryId) => categoryId.trim()).filter(Boolean))]
      : [];
    const requestedModalCategoryId = body.modalCategoryId?.trim() || null;
    const requestedModalCategoryName = body.modalCategory?.trim() || null;
    const credits = Math.max(0, safeParseNumber(body.credits));
    const priorityStatus = body.priorityStatus === "prioritario" ? "prioritario" : "normal";
    const sortOrder = Number.isFinite(body.sortOrder) ? Number(body.sortOrder) : 0;
    const isActive = body.isActive ?? true;
    const taskIds = Array.isArray(body.taskIds)
      ? [...new Set(body.taskIds.map((taskId) => taskId.trim()).filter(Boolean))]
      : [];
    const allowedTags = ["Inmobiliaria", "Salud", "Ecommerce"];
    const tags = Array.isArray(body.tags)
      ? body.tags.filter((tag): tag is string => allowedTags.includes(tag))
      : null;

    if (!name) {
      return NextResponse.json({ message: "El nombre del grupo es requerido." }, { status: 400 });
    }

    if (!taskIds.length && credits <= 0) {
      return NextResponse.json(
        { message: "Agrega tareas al grupo o define una cantidad de creditos mayor a cero." },
        { status: 400 },
      );
    }

    let selectedCategories: Array<{ id: string; name: string }> = [];
    const normalizedRequestedCategoryIds = requestedModalCategoryIds.length
      ? requestedModalCategoryIds
      : requestedModalCategoryId
        ? [requestedModalCategoryId]
        : [];

    if (normalizedRequestedCategoryIds.length) {
      const { data: categoryRows, error: categoryError } = await supabase
        .from("credit_catalog_group_categories")
        .select("id, name")
        .in("id", normalizedRequestedCategoryIds);

      if (categoryError) throw categoryError;
      const categoryRowsById = new Map((categoryRows ?? []).map((category) => [category.id, category]));
      selectedCategories = normalizedRequestedCategoryIds
        .map((categoryId) => categoryRowsById.get(categoryId) ?? null)
        .filter((category): category is { id: string; name: string } => Boolean(category));

      if (selectedCategories.length !== normalizedRequestedCategoryIds.length) {
        return NextResponse.json(
          { message: "Una o mas categorias del caso de uso ya no existen." },
          { status: 400 },
        );
      }
    } else if (requestedModalCategoryName) {
      const { data: categoryRow, error: categoryError } = await supabase
        .from("credit_catalog_group_categories")
        .select("id, name")
        .ilike("name", requestedModalCategoryName)
        .maybeSingle();

      if (categoryError) throw categoryError;
      selectedCategories = categoryRow ? [categoryRow] : [];
    }

    const primaryCategory = selectedCategories[0] ?? null;

    const { data, error } = await supabase
      .from("credit_catalog_groups")
      .insert({
        name,
        description,
        modal_category: primaryCategory?.name ?? null,
        modal_category_id: primaryCategory?.id ?? null,
        credits,
        priority_status: priorityStatus,
        sort_order: sortOrder,
        is_active: isActive,
        tags: tags?.length ? tags : null,
        created_by_user_id: user.id,
      })
      .select("*")
      .single();

    if (error) throw error;

    if (selectedCategories.length) {
      const selectedCategoryIds = selectedCategories.map((category) => category.id);
      const { data: existingLinks, error: existingLinksError } = await supabase
        .from("credit_catalog_group_category_links")
        .select("category_id, sort_order")
        .in("category_id", selectedCategoryIds);

      if (existingLinksError) {
        throw existingLinksError;
      }

      const nextSortOrderByCategoryId = new Map<string, number>();
      for (const categoryId of selectedCategoryIds) {
        const currentMax = Math.max(
          -1,
          ...(existingLinks ?? [])
            .filter((link) => link.category_id === categoryId)
            .map((link) => safeParseNumber(link.sort_order)),
        );
        nextSortOrderByCategoryId.set(categoryId, currentMax + 1);
      }

      const { error: categoryLinksError } = await supabase
        .from("credit_catalog_group_category_links")
        .insert(
          selectedCategories.map((category) => ({
            group_id: data.id,
            category_id: category.id,
            sort_order: nextSortOrderByCategoryId.get(category.id) ?? 0,
          })),
        );

      if (categoryLinksError) {
        throw categoryLinksError;
      }
    }

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
