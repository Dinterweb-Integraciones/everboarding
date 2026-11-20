import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { canAccessAdminCatalogs } from "@/lib/platform-access";
import { createPriceListLink } from "@/lib/price-list-links-server";
import { getPriceListById } from "@/lib/price-lists-server";
import { formatUserError } from "@/lib/utils";

type PriceListLinksRouteProps = {
  params: Promise<{ priceListId: string }>;
};

// Crea un enlace para vendedores externos sobre la lista.
export async function POST(request: Request, { params }: PriceListLinksRouteProps) {
  try {
    const { platformProfile } = await requireUser("/cs/listas-precios");

    if (!canAccessAdminCatalogs(platformProfile?.platform_role ?? null)) {
      return NextResponse.json(
        { message: "Solo administradores pueden gestionar listas de precios." },
        { status: 403 },
      );
    }

    const { priceListId } = await params;
    const priceList = await getPriceListById(priceListId);

    if (!priceList) {
      return NextResponse.json({ message: "No encontramos la lista de precios." }, { status: 404 });
    }

    const body = (await request.json().catch(() => ({}))) as { label?: unknown };
    const label = String(body.label ?? "").trim().slice(0, 120);

    return NextResponse.json(await createPriceListLink(priceList.id, label || null));
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos crear el enlace.") },
      { status: 400 },
    );
  }
}
