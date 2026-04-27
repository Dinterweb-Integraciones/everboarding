import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { formatUserError } from "@/lib/utils";

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = (await request.json()) as {
      name?: string;
      description?: string | null;
      sortOrder?: number;
      isActive?: boolean;
      taskIds?: string[];
    };

    const name = body.name?.trim();
    const description = body.description?.trim() || null;
    const sortOrder = Number.isFinite(body.sortOrder) ? Number(body.sortOrder) : 0;
    const isActive = body.isActive ?? true;

    if (!name) {
      return NextResponse.json({ message: "El nombre del grupo es requerido." }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("credit_catalog_groups")
      .insert({
        name,
        description,
        sort_order: sortOrder,
        is_active: isActive,
        created_by_user_id: user.id,
      })
      .select("*")
      .single();

    if (error) throw error;

    const taskIds = Array.isArray(body.taskIds)
      ? [...new Set(body.taskIds.map((taskId) => taskId.trim()).filter(Boolean))]
      : [];

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
