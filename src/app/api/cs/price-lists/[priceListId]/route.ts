import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { canAccessAdminCatalogs } from "@/lib/platform-access";
import { isDuplicatePriceListNameError, parsePriceListInput } from "@/lib/price-lists-input";
import { mapPriceListRow } from "@/lib/price-lists-server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatUserError } from "@/lib/utils";

type PriceListRouteProps = {
  params: Promise<{ priceListId: string }>;
};

async function ensureCatalogAdmin() {
  const { platformProfile } = await requireUser("/cs/listas-precios");
  return canAccessAdminCatalogs(platformProfile?.platform_role ?? null);
}

export async function PUT(request: Request, { params }: PriceListRouteProps) {
  try {
    if (!(await ensureCatalogAdmin())) {
      return NextResponse.json(
        { message: "Solo administradores pueden gestionar listas de precios." },
        { status: 403 },
      );
    }

    const { priceListId } = await params;
    const parsed = parsePriceListInput(await request.json());

    if (!parsed.ok) {
      return NextResponse.json({ message: parsed.message }, { status: 400 });
    }

    // price_lists no está en database.ts (ver límite de complejidad de tipos).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createSupabaseAdminClient() as any;
    const { data, error } = await admin
      .from("price_lists")
      .update(parsed.value)
      .eq("id", priceListId)
      .select("*")
      .single();

    if (error) {
      if (isDuplicatePriceListNameError(error)) {
        return NextResponse.json({ message: "Ya existe una lista con ese nombre." }, { status: 400 });
      }

      throw error;
    }

    return NextResponse.json(mapPriceListRow(data as Record<string, unknown>));
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos actualizar la lista de precios.") },
      { status: 400 },
    );
  }
}

export async function DELETE(_: Request, { params }: PriceListRouteProps) {
  try {
    if (!(await ensureCatalogAdmin())) {
      return NextResponse.json(
        { message: "Solo administradores pueden gestionar listas de precios." },
        { status: 403 },
      );
    }

    const { priceListId } = await params;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createSupabaseAdminClient() as any;
    const { count, error: countError } = await admin
      .from("clients")
      .select("id", { count: "exact", head: true })
      .eq("price_list_id", priceListId);

    if (countError) throw countError;

    // Borrarla dejaría a esos clientes con los créditos base sin aviso; mejor desactivarla.
    if ((count ?? 0) > 0) {
      return NextResponse.json(
        {
          message: `La lista está asignada a ${count} cliente(s). Desactívala o reasigna esos clientes antes de eliminarla.`,
        },
        { status: 400 },
      );
    }

    const { error } = await admin.from("price_lists").delete().eq("id", priceListId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos eliminar la lista de precios.") },
      { status: 400 },
    );
  }
}
