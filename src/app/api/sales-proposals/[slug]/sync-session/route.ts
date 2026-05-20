import { NextResponse } from "next/server";

import { getSalesProposalMutationAccess } from "@/lib/sales-proposal-access";
import { syncSalesProposalCheckoutStatus } from "@/lib/sales-proposals-server";
import { formatUserError } from "@/lib/utils";

type SalesProposalSyncRouteProps = {
  params: Promise<{ slug: string }>;
};

type SyncSalesProposalBody = {
  sessionId?: string;
};

export async function POST(request: Request, { params }: SalesProposalSyncRouteProps) {
  try {
    const { slug } = await params;
    const proposalAccess = await getSalesProposalMutationAccess(slug);

    if (!proposalAccess.ok) {
      return NextResponse.json({ message: proposalAccess.message }, { status: proposalAccess.status });
    }

    const body = (await request.json()) as SyncSalesProposalBody;
    const proposal = await syncSalesProposalCheckoutStatus(slug, body.sessionId);

    return NextResponse.json({ proposal });
  } catch (caughtError) {
    return NextResponse.json(
      {
        message: formatUserError(
          caughtError,
          "No pudimos confirmar el estado de pago de la propuesta.",
        ),
      },
      { status: 400 },
    );
  }
}
