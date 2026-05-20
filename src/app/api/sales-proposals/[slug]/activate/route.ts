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

    const activationResult = await activateSalesProposal(request, proposalAccess.proposal);

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
