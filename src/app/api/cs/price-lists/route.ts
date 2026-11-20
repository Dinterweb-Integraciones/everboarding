import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { canAccessAdminCatalogs } from "@/lib/platform-access";
import { isDuplicatePriceListNameError, parsePriceListInput } from "@/lib/price-lists-input";
import { mapPriceListRow } from "@/lib/price-lists-server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatUserError } from "@/lib/utils";

export async function POST(request: Request) {
  try {
    const { platformProfile } = await requireUser("/cs/listas-precios");

    if (!canAccessAdminCatalogs(platformProfile?.platform_role ?? null)) {
      return NextResponse.json(
        { message: "Solo administradores pueden gestionar listas de precios." },
        { status: 403 },
      );
    }

    const parsed = parsePriceListInput(await request.json());

    if (!parsed.ok) {
      return NextResponse.json({ message: parsed.message }, { status: 400 });
    }

    // price_lists no está en database.ts (ver límite de complejidad de tipos).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createSupabaseAdminClient() as any;
    const { data, error } = await admin.from("price_lists").insert(parsed.value).select("*").single();

    if (error) {
      if (isDuplicatePriceListNameError(error)) {
        return NextResponse.json({ message: "Ya existe una lista con ese nombre." }, { status: 400 });
      }

      throw error;
    }

    return NextResponse.json(mapPriceListRow(data as Record<string, unknown>));
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos crear la lista de precios.") },
      { status: 400 },
    );
  }
}
