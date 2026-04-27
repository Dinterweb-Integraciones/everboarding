import { NextResponse } from "next/server";

import { generateSalesProposalSlug, normalizeSalesProposalDraft } from "@/lib/sales-proposals";
import { saveSalesProposal } from "@/lib/sales-proposals-server";
import { formatUserError } from "@/lib/utils";

export async function POST(request: Request) {
  try {
    const body = normalizeSalesProposalDraft(await request.json());
    const slug = body.slug || generateSalesProposalSlug(body);
    const proposal = await saveSalesProposal(body, slug);

    return NextResponse.json(proposal);
  } catch (caughtError) {
    return NextResponse.json(
      {
        message: formatUserError(
          caughtError,
          "No pudimos crear la propuesta comercial en este momento.",
        ),
      },
      { status: 400 },
    );
  }
}
