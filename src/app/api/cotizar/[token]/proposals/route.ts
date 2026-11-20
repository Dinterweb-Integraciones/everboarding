import { NextResponse } from "next/server";

import { setSalesProposalPriceListLinkId } from "@/lib/price-list-links-server";
import {
  enforcePriceListLinkRateLimit,
  priceListLinkErrorResponse,
  requireActivePriceListLink,
  requirePriceListLinkProposal,
  requirePriceListLinkProposalCapacity,
  sanitizePriceListLinkDraft,
} from "@/lib/price-list-link-proposals-server";
import { getSalesProposalBySlug } from "@/lib/sales-proposal-access";
import { generateSalesProposalSlug } from "@/lib/sales-proposals";
import { saveSalesProposal } from "@/lib/sales-proposals-server";
import { formatUserError } from "@/lib/utils";

type PriceListLinkProposalsRouteProps = {
  params: Promise<{ token: string }>;
};

// Crea la propuesta de un vendedor externo con la tarifa del enlace.
export async function POST(request: Request, { params }: PriceListLinkProposalsRouteProps) {
  try {
    const { token } = await params;
    const linkAccess = await requireActivePriceListLink(token);
    if (!linkAccess.ok) return linkAccess.response;

    const input = (await request.json()) as Record<string, unknown>;

    // Dos autoguardados cruzados reenvían el slug que el servidor devolvió al crear: si es una
    // propuesta de este mismo enlace y sigue en borrador, se actualiza en vez de duplicarla.
    const requestedSlug = typeof input.slug === "string" ? input.slug.trim() : "";
    if (requestedSlug) {
      const ownProposal = await requirePriceListLinkProposal(linkAccess.context, requestedSlug);

      if (ownProposal.ok) {
        const rateLimitedUpdate = await enforcePriceListLinkRateLimit(request, linkAccess.context, "update");
        if (rateLimitedUpdate) return rateLimitedUpdate;

        const sanitizedUpdate = await sanitizePriceListLinkDraft(input, linkAccess.context, ownProposal.proposal);
        if (!sanitizedUpdate.ok) return priceListLinkErrorResponse(sanitizedUpdate.message);

        return NextResponse.json(
          await saveSalesProposal({ ...sanitizedUpdate.draft, id: ownProposal.proposal.id, slug: requestedSlug }, requestedSlug),
        );
      }
    }

    const rateLimited = await enforcePriceListLinkRateLimit(request, linkAccess.context, "create");
    if (rateLimited) return rateLimited;

    const overCapacity = await requirePriceListLinkProposalCapacity(linkAccess.context);
    if (overCapacity) return overCapacity;

    const sanitized = await sanitizePriceListLinkDraft(input, linkAccess.context, null);
    if (!sanitized.ok) return priceListLinkErrorResponse(sanitized.message);

    // Al crear, el slug lo genera siempre el servidor (con sufijo aleatorio): es lo único que separa
    // las propuestas de distintos vendedores que comparten el enlace, así que no puede ser adivinable.
    let slug = generateSalesProposalSlug(sanitized.draft);
    while (await getSalesProposalBySlug(slug)) {
      slug = generateSalesProposalSlug(sanitized.draft);
    }

    const proposal = await saveSalesProposal({ ...sanitized.draft, id: undefined, slug }, slug);
    await setSalesProposalPriceListLinkId(slug, linkAccess.context.link.id);

    return NextResponse.json(proposal);
  } catch (caughtError) {
    return priceListLinkErrorResponse(
      formatUserError(caughtError, "No pudimos crear la propuesta comercial en este momento."),
    );
  }
}
