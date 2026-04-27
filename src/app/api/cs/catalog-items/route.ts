import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { formatUserError, safeParseNumber } from "@/lib/utils";

export async function POST(request: Request) {
  try {
    const { supabase } = await requireUser();
    const body = (await request.json()) as {
      category?: string | null;
      label?: string;
      credits?: number;
      sortOrder?: number;
      isActive?: boolean;
    };

    const label = body.label?.trim();
    const category = body.category?.trim() || "General";
    const credits = safeParseNumber(body.credits);
    const sortOrder = safeParseNumber(body.sortOrder);
    const isActive = body.isActive ?? true;

    if (!label) {
      return NextResponse.json({ message: "El nombre de la tarea es requerido." }, { status: 400 });
    }

    if (credits <= 0) {
      return NextResponse.json(
        { message: "Los créditos deben ser mayores a cero." },
        { status: 400 },
      );
    }

    const { data, error } = await supabase
      .from("credit_catalog_items")
      .insert({
        category,
        label,
        credits,
        sort_order: sortOrder,
        is_active: isActive,
      })
      .select("*")
      .single();

    if (error) throw error;

    return NextResponse.json(data);
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos crear la tarea.") },
      { status: 400 },
    );
  }
}
