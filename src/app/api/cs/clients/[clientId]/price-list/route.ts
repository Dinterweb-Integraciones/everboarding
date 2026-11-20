import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { canAccessAdminCatalogs } from "@/lib/platform-access";
import { assignClientPriceList, getPriceListById } from "@/lib/price-lists-server";
import { formatUserError } from "@/lib/utils";

// Cambia la lista de precios con la que se cotizan los casos de uso del cliente. Los casos que ya
// tiene conservan sus créditos; la lista aplica a los que se agreguen desde ahora.
export async function PUT(
  request: Request,
  context: { params: Promise<{ clientId: string }> },
) {
  try {
    const { platformProfile } = await requireUser("/cs/clientes");

    if (!canAccessAdminCatalogs(platformProfile?.platform_role ?? null)) {
      return NextResponse.json(
        { message: "Solo administradores pueden cambiar la lista de precios de un cliente." },
        { status: 403 },
      );
    }

    const { clientId } = await context.params;
    const body = (await request.json()) as { priceListId?: unknown };
    const priceListId =
      typeof body.priceListId === "string" && body.priceListId.trim() ? body.priceListId.trim() : null;

    if (!clientId) {
      return NextResponse.json({ message: "El cliente no es valido." }, { status: 400 });
    }

    const priceList = priceListId ? await getPriceListById(priceListId) : null;

    if (priceListId && !priceList) {
      return NextResponse.json({ message: "La lista de precios no existe." }, { status: 400 });
    }

    await assignClientPriceList(clientId, priceListId);

    return NextResponse.json({
      priceListId,
      message: priceList
        ? `Los casos de uso del cliente se cotizarán con la lista ${priceList.name}.`
        : "El cliente volvió a los créditos base del catálogo.",
    });
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos cambiar la lista de precios del cliente.") },
      { status: 400 },
    );
  }
}
