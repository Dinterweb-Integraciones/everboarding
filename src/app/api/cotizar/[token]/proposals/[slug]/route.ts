import { NextResponse } from "next/server";

import {
  enforcePriceListLinkRateLimit,
  priceListLinkErrorResponse,
  requireActivePriceListLink,
  requirePriceListLinkProposal,
  sanitizePriceListLinkDraft,
} from "@/lib/price-list-link-proposals-server";
import { saveSalesProposal } from "@/lib/sales-proposals-server";
import { formatUserError } from "@/lib/utils";

type PriceListLinkProposalRouteProps = {
  params: Promise<{ token: string; slug: string }>;
};

// Guarda los cambios del vendedor externo mientras arma la propuesta (solo en borrador).
export async function PUT(request: Request, { params }: PriceListLinkProposalRouteProps) {
  try {
    const { token, slug } = await params;
    const linkAccess = await requireActivePriceListLink(token);
    if (!linkAccess.ok) return linkAccess.response;

    const rateLimited = await enforcePriceListLinkRateLimit(request, linkAccess.context, "update");
    if (rateLimited) return rateLimited;

    const proposalAccess = await requirePriceListLinkProposal(linkAccess.context, slug);
    if (!proposalAccess.ok) return proposalAccess.response;

    const sanitized = await sanitizePriceListLinkDraft(
      await request.json(),
      linkAccess.context,
      proposalAccess.proposal,
    );
    if (!sanitized.ok) return priceListLinkErrorResponse(sanitized.message);

    const proposal = await saveSalesProposal(
      { ...sanitized.draft, id: proposalAccess.proposal.id, slug },
      slug,
    );

    return NextResponse.json(proposal);
  } catch (caughtError) {
    return priceListLinkErrorResponse(
      formatUserError(caughtError, "No pudimos actualizar la propuesta comercial."),
    );
  }
}
