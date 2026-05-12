import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { safeParseNumber, formatUserError } from "@/lib/utils";

export async function POST(request: Request) {
  try {
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
      .insert({
        name,
        description,
        sort_order: sortOrder,
        is_active: isActive,
      })
      .select("*")
      .single();

    if (error) throw error;

    return NextResponse.json(data);
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos crear la categoria de grupo.") },
      { status: 400 },
    );
  }
}
