import { NextResponse } from "next/server";

import { getSalesProposalMutationAccess } from "@/lib/sales-proposal-access";
import { removeSalesCouponFromProposal } from "@/lib/sales-proposals-server";
import { formatCurrency, formatUserError } from "@/lib/utils";

type SalesProposalRemoveCouponRouteProps = {
  params: Promise<{ slug: string }>;
};

export async function POST(_request: Request, { params }: SalesProposalRemoveCouponRouteProps) {
  try {
    const { slug } = await params;
    const proposalAccess = await getSalesProposalMutationAccess(slug);

    if (!proposalAccess.ok) {
      return NextResponse.json({ message: proposalAccess.message }, { status: proposalAccess.status });
    }

    const proposal = await removeSalesCouponFromProposal(slug);

    return NextResponse.json({
      proposal,
      message: `Cupon removido. La propuesta queda en ${proposal.contractedCredits} creditos por ${formatCurrency(proposal.quotedPrice, proposal.currency.toUpperCase())}.`,
    });
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos remover el cupon.") },
      { status: 400 },
    );
  }
}
