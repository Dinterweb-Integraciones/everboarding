import { NextResponse } from "next/server";

import { resolveAppOrigin } from "@/lib/app-origin";
import {
  enforcePriceListLinkRateLimit,
  priceListLinkErrorResponse,
  requireActivePriceListLink,
  requirePriceListLinkProposal,
} from "@/lib/price-list-link-proposals-server";
import { activateSalesProposal } from "@/lib/sales-proposals-server";
import { formatUserError } from "@/lib/utils";

type PriceListLinkActivateRouteProps = {
  params: Promise<{ token: string; slug: string }>;
};

// "Activar plan" del vendedor externo: prepara el checkout del cliente, igual que el vendedor interno.
export async function POST(request: Request, { params }: PriceListLinkActivateRouteProps) {
  try {
    const { token, slug } = await params;
    const linkAccess = await requireActivePriceListLink(token);
    if (!linkAccess.ok) return linkAccess.response;

    const rateLimited = await enforcePriceListLinkRateLimit(request, linkAccess.context, "activate");
    if (rateLimited) return rateLimited;

    const proposalAccess = await requirePriceListLinkProposal(linkAccess.context, slug);
    if (!proposalAccess.ok) return proposalAccess.response;

    const origin = resolveAppOrigin(request);
    const activationResult = await activateSalesProposal(request, proposalAccess.proposal, {
      successUrl: `${origin}/public/prospect/${slug}/agendar?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    });

    return NextResponse.json(activationResult);
  } catch (caughtError) {
    return priceListLinkErrorResponse(
      formatUserError(caughtError, "No pudimos activar el plan ni preparar el checkout del cliente."),
    );
  }
}
