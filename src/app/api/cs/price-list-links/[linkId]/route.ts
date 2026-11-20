import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { canAccessAdminCatalogs } from "@/lib/platform-access";
import { deletePriceListLink, updatePriceListLink } from "@/lib/price-list-links-server";
import { formatUserError } from "@/lib/utils";

type PriceListLinkRouteProps = {
  params: Promise<{ linkId: string }>;
};

async function ensureCatalogAdmin() {
  const { platformProfile } = await requireUser("/cs/listas-precios");
  return canAccessAdminCatalogs(platformProfile?.platform_role ?? null);
}

const FORBIDDEN_MESSAGE = "Solo administradores pueden gestionar listas de precios.";

// Activa o desactiva el enlace, o cambia su etiqueta.
export async function PATCH(request: Request, { params }: PriceListLinkRouteProps) {
  try {
    if (!(await ensureCatalogAdmin())) {
      return NextResponse.json({ message: FORBIDDEN_MESSAGE }, { status: 403 });
    }

    const { linkId } = await params;
    const body = (await request.json().catch(() => ({}))) as { isActive?: unknown; label?: unknown };
    const patch: { is_active?: boolean; label?: string | null } = {};

    if (typeof body.isActive === "boolean") patch.is_active = body.isActive;
    if (body.label !== undefined) patch.label = String(body.label ?? "").trim().slice(0, 120) || null;

    return NextResponse.json(await updatePriceListLink(linkId, patch));
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos actualizar el enlace.") },
      { status: 400 },
    );
  }
}

// Las propuestas creadas con el enlace se conservan (price_list_link_id queda en null).
export async function DELETE(_: Request, { params }: PriceListLinkRouteProps) {
  try {
    if (!(await ensureCatalogAdmin())) {
      return NextResponse.json({ message: FORBIDDEN_MESSAGE }, { status: 403 });
    }

    const { linkId } = await params;
    await deletePriceListLink(linkId);

    return NextResponse.json({ success: true });
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos eliminar el enlace.") },
      { status: 400 },
    );
  }
}
