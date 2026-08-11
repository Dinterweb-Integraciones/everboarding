import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { canAccessAdminCatalogs } from "@/lib/platform-access";
import { formatUserError, safeParseNumber } from "@/lib/utils";

type GroupRouteProps = {
  params: Promise<{ groupId: string }>;
};

export async function PUT(request: Request, { params }: GroupRouteProps) {
  try {
    const { groupId } = await params;
    const { supabase, platformProfile } = await requireUser();
    if (!canAccessAdminCatalogs(platformProfile?.platform_role)) {
      return NextResponse.json({ message: "No tienes permisos para administrar el catalogo." }, { status: 403 });
    }

    const body = (await request.json()) as {
      name?: string;
      description?: string | null;
      preview?: string | null;
      completionOutcome?: string | null;
      successMilestone?: string | null;
      displayBadge?: string | null;
      cluster?: string | null;
      clusterIds?: string[] | null;
      useCaseCode?: string | null;
      nextLogicalUseCases?: string | null;
      previousUseCases?: string | null;
      subsequentUseCases?: string | null;
      modalCategoryIds?: string[] | null;
      modalCategoryId?: string | null;
      modalCategory?: string | null;
      useCaseCategoryId?: string | null;
      credits?: number;
      sortOrder?: number;
      isActive?: boolean;
      isPublic?: boolean;
      taskIds?: string[];
      tags?: string[] | null;
    };

    const name = body.name?.trim();
    const description = body.description?.trim() || null;
    const preview = body.preview?.trim() || null;
    const completionOutcome = body.completionOutcome?.trim() || null;
    const successMilestone = body.successMilestone?.trim() || null;
    const displayBadge = body.displayBadge?.trim() || null;
    const requestedClusterIds = Array.isArray(body.clusterIds)
      ? [...new Set(body.clusterIds.map((clusterId) => clusterId.trim()).filter(Boolean))]
      : [];
    const useCaseCode = body.useCaseCode?.trim() || null;
    const nextLogicalUseCases = body.nextLogicalUseCases?.trim() || null;
    const previousUseCases = body.previousUseCases?.trim() || null;
    const subsequentUseCases = body.subsequentUseCases?.trim() || null;
    const requestedModalCategoryIds = Array.isArray(body.modalCategoryIds)
      ? [...new Set(body.modalCategoryIds.map((categoryId) => categoryId.trim()).filter(Boolean))]
      : [];
    const requestedModalCategoryId = body.modalCategoryId?.trim() || null;
    const requestedModalCategoryName = body.modalCategory?.trim() || null;
    const requestedUseCaseCategoryId = body.useCaseCategoryId?.trim() || null;
    const credits = Math.max(0, safeParseNumber(body.credits));
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

    if (!useCaseCode) {
      return NextResponse.json({ message: "El código #CU es requerido." }, { status: 400 });
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

    if (requestedUseCaseCategoryId) {
      const { data: useCaseCategory, error: useCaseCategoryError } = await supabase
        .from("credit_catalog_use_case_categories")
        .select("id")
        .eq("id", requestedUseCaseCategoryId)
        .maybeSingle();

      if (useCaseCategoryError) throw useCaseCategoryError;
      if (!useCaseCategory) {
        return NextResponse.json(
          { message: "La categoría de casos de uso seleccionada ya no existe." },
          { status: 400 },
        );
      }
    }

    let selectedClusters: Array<{ id: string; label: string }> = [];
    if (requestedClusterIds.length) {
      const { data: clusterRows, error: clustersError } = await supabase
        .from("credit_catalog_group_clusters")
        .select("id, label")
        .in("id", requestedClusterIds);

      if (clustersError) throw clustersError;
      const clustersById = new Map((clusterRows ?? []).map((cluster) => [cluster.id, cluster]));
      selectedClusters = requestedClusterIds
        .map((clusterId) => clustersById.get(clusterId) ?? null)
        .filter((cluster): cluster is { id: string; label: string } => Boolean(cluster));

      if (selectedClusters.length !== requestedClusterIds.length) {
        return NextResponse.json(
          { message: "Uno o mas clusters seleccionados ya no existen." },
          { status: 400 },
        );
      }
    }

    const { data: currentGroup, error: currentError } = await supabase
      .from("credit_catalog_groups")
      .select("*")
      .eq("id", groupId)
      .single();

    if (currentError || !currentGroup) {
      return NextResponse.json({ message: "No encontramos el grupo." }, { status: 404 });
    }

    const cluster = selectedClusters[0]?.label ?? (body.cluster?.trim() || null);

    const { data, error } = await supabase
      .from("credit_catalog_groups")
      .update({
        name,
        description,
        preview,
        completion_outcome: completionOutcome,
        success_milestone: successMilestone,
        display_badge: displayBadge,
        cluster,
        use_case_code: useCaseCode,
        next_logical_use_cases: nextLogicalUseCases,
        previous_use_cases: previousUseCases,
        subsequent_use_cases: subsequentUseCases,
        modal_category: primaryCategory?.name ?? null,
        modal_category_id: primaryCategory?.id ?? null,
        use_case_category_id: requestedUseCaseCategoryId,
        credits,
        sort_order: sortOrder,
        is_active: isActive,
        is_public: body.isPublic ?? currentGroup.is_public,
        tags: tags?.length ? tags : null,
      })
      .eq("id", groupId)
      .select("*")
      .single();

    if (error?.code === "23505" && error.message.includes("use_case_code")) {
      return NextResponse.json(
        { message: "El código #CU ya está asignado a otro caso de uso." },
        { status: 409 },
      );
    }

    if (error || !data) throw error ?? new Error("No pudimos actualizar el grupo.");

    const { error: deleteClusterLinksError } = await supabase
      .from("credit_catalog_group_cluster_links")
      .delete()
      .eq("group_id", groupId);

    if (deleteClusterLinksError) throw deleteClusterLinksError;

    if (selectedClusters.length) {
      const { error: insertClusterLinksError } = await supabase
        .from("credit_catalog_group_cluster_links")
        .insert(
          selectedClusters.map((selectedCluster, index) => ({
            group_id: groupId,
            cluster_id: selectedCluster.id,
            sort_order: index,
          })),
        );

      if (insertClusterLinksError) throw insertClusterLinksError;
    }

    const { data: existingCategoryLinks, error: existingCategoryLinksError } = await supabase
      .from("credit_catalog_group_category_links")
      .select("id, category_id, sort_order")
      .eq("group_id", groupId);

    if (existingCategoryLinksError) {
      throw existingCategoryLinksError;
    }

    const existingCategoryLinksByCategoryId = new Map(
      (existingCategoryLinks ?? []).map((link) => [link.category_id, link] as const),
    );
    const selectedCategoryIds = selectedCategories.map((category) => category.id);
    const categoryIdsToRemove = (existingCategoryLinks ?? [])
      .map((link) => link.category_id)
      .filter((categoryId) => !selectedCategoryIds.includes(categoryId));
    const categoriesToAdd = selectedCategories.filter(
      (category) => !existingCategoryLinksByCategoryId.has(category.id),
    );

    if (categoryIdsToRemove.length) {
      const { error: deleteCategoryLinksError } = await supabase
        .from("credit_catalog_group_category_links")
        .delete()
        .eq("group_id", groupId)
        .in("category_id", categoryIdsToRemove);

      if (deleteCategoryLinksError) {
        throw deleteCategoryLinksError;
      }
    }

    if (categoriesToAdd.length) {
      const categoryIdsToAdd = categoriesToAdd.map((category) => category.id);
      const { data: categoryLinksForOrdering, error: categoryLinksForOrderingError } = await supabase
        .from("credit_catalog_group_category_links")
        .select("category_id, sort_order")
        .in("category_id", categoryIdsToAdd);

      if (categoryLinksForOrderingError) {
        throw categoryLinksForOrderingError;
      }

      const nextSortOrderByCategoryId = new Map<string, number>();
      for (const categoryId of categoryIdsToAdd) {
        const currentMax = Math.max(
          -1,
          ...(categoryLinksForOrdering ?? [])
            .filter((link) => link.category_id === categoryId)
            .map((link) => safeParseNumber(link.sort_order)),
        );
        nextSortOrderByCategoryId.set(categoryId, currentMax + 1);
      }

      const { error: insertCategoryLinksError } = await supabase
        .from("credit_catalog_group_category_links")
        .insert(
          categoriesToAdd.map((category) => ({
            group_id: groupId,
            category_id: category.id,
            sort_order: nextSortOrderByCategoryId.get(category.id) ?? 0,
          })),
        );

      if (insertCategoryLinksError) {
        throw insertCategoryLinksError;
      }
    }

    const { error: deleteMembershipLinksError } = await supabase
      .from("credit_catalog_group_items")
      .delete()
      .eq("group_id", groupId);

    if (deleteMembershipLinksError) {
      throw deleteMembershipLinksError;
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
    const { supabase, platformProfile } = await requireUser();
    if (!canAccessAdminCatalogs(platformProfile?.platform_role)) {
      return NextResponse.json({ message: "No tienes permisos para administrar el catalogo." }, { status: 403 });
    }

    const { error: detachCategoryLinksError } = await supabase
      .from("credit_catalog_group_category_links")
      .delete()
      .eq("group_id", groupId);

    if (detachCategoryLinksError) throw detachCategoryLinksError;

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
