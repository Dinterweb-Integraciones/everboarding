import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { formatUserError } from "@/lib/utils";

type ReorderGroupsRouteProps = {
  params: Promise<{ categoryId: string }>;
};

export async function PUT(request: Request, { params }: ReorderGroupsRouteProps) {
  try {
    const { categoryId } = await params;
    const { supabase } = await requireUser();
    const body = (await request.json()) as {
      groupIds?: string[];
    };

    const requestedGroupIds = Array.isArray(body.groupIds)
      ? [...new Set(body.groupIds.map((groupId) => groupId.trim()).filter(Boolean))]
      : [];

    const { data: existingLinks, error: existingLinksError } = await supabase
      .from("credit_catalog_group_category_links")
      .select("id, group_id")
      .eq("category_id", categoryId)
      .order("sort_order")
      .order("created_at");

    if (existingLinksError) {
      throw existingLinksError;
    }

    const existingGroupIds = (existingLinks ?? []).map((link) => link.group_id);

    if (!existingGroupIds.length) {
      return NextResponse.json({ message: "La categoria no tiene casos de uso para ordenar." }, { status: 400 });
    }

    if (
      requestedGroupIds.length !== existingGroupIds.length
      || requestedGroupIds.some((groupId) => !existingGroupIds.includes(groupId))
    ) {
      return NextResponse.json(
        { message: "Debes enviar el listado completo y vigente de casos de uso de la categoria." },
        { status: 400 },
      );
    }

    const linkIdByGroupId = new Map((existingLinks ?? []).map((link) => [link.group_id, link.id] as const));

    const updateResults = await Promise.all(
      requestedGroupIds.map((groupId, index) =>
        supabase
          .from("credit_catalog_group_category_links")
          .update({ sort_order: index })
          .eq("id", linkIdByGroupId.get(groupId) ?? ""),
      ),
    );

    const failedUpdate = updateResults.find((result) => result.error);
    if (failedUpdate?.error) {
      throw failedUpdate.error;
    }

    return NextResponse.json({ success: true });
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos reordenar los casos de uso de la categoria.") },
      { status: 400 },
    );
  }
}
