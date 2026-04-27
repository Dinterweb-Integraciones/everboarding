import { NextResponse } from "next/server";

import { normalizeSalesProposalDraft } from "@/lib/sales-proposals";
import { saveSalesProposal } from "@/lib/sales-proposals-server";
import { formatUserError } from "@/lib/utils";

type SalesProposalRouteProps = {
  params: Promise<{ slug: string }>;
};

export async function PUT(request: Request, { params }: SalesProposalRouteProps) {
  try {
    const { slug } = await params;
    const body = normalizeSalesProposalDraft(await request.json());
    const proposal = await saveSalesProposal(body, slug);

    return NextResponse.json(proposal);
  } catch (caughtError) {
    return NextResponse.json(
      {
        message: formatUserError(
          caughtError,
          "No pudimos actualizar la propuesta comercial.",
        ),
      },
      { status: 400 },
    );
  }
}
