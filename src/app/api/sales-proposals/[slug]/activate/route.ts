import { NextResponse } from "next/server";

import { getSalesProposalMutationAccess } from "@/lib/sales-proposal-access";
import { activateSalesProposal } from "@/lib/sales-proposals-server";
import { formatUserError } from "@/lib/utils";

type SalesProposalActivateRouteProps = {
  params: Promise<{ slug: string }>;
};

export async function POST(request: Request, { params }: SalesProposalActivateRouteProps) {
  try {
    const { slug } = await params;
    const proposalAccess = await getSalesProposalMutationAccess(slug);

    if (!proposalAccess.ok) {
      return NextResponse.json({ message: proposalAccess.message }, { status: proposalAccess.status });
    }

    const requestOrigin = request.headers.get("origin") || new URL(request.url).origin;
    const origin =
      requestOrigin.includes("localhost") || requestOrigin.includes("127.0.0.1")
        ? requestOrigin.replace(/\/$/, "")
        : (process.env.NEXT_PUBLIC_SITE_URL || requestOrigin).replace(/\/$/, "");
    const activationResult = await activateSalesProposal(request, proposalAccess.proposal, {
      successUrl: `${origin}/public/prospect/${slug}/agendar?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    });

    return NextResponse.json(activationResult);
  } catch (caughtError) {
    return NextResponse.json(
      {
        message: formatUserError(
          caughtError,
          "No pudimos activar el plan ni preparar el checkout del cliente.",
        ),
      },
      { status: 400 },
    );
  }
}
