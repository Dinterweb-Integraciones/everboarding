import { NextResponse } from "next/server";

import { applySalesCouponToProposal } from "@/lib/sales-proposals-server";
import { formatCurrency, formatUserError } from "@/lib/utils";

type SalesProposalApplyCouponRouteProps = {
  params: Promise<{ slug: string }>;
};

export async function POST(request: Request, { params }: SalesProposalApplyCouponRouteProps) {
  try {
    const { slug } = await params;
    const body = (await request.json()) as {
      code?: string;
    };
    const code = body.code?.trim() || "";

    if (!code) {
      return NextResponse.json({ message: "Ingresa un cupon antes de intentar canjearlo." }, { status: 400 });
    }

    const proposal = await applySalesCouponToProposal(slug, code);

    return NextResponse.json({
      proposal,
      message:
        proposal.quotedPrice <= 0
          ? `Cupon aplicado. La propuesta queda en ${proposal.contractedCredits} creditos, ${formatCurrency(proposal.quotedPrice, proposal.currency.toUpperCase())} y podra activarse sin pasarela.`
          : `Cupon aplicado. La propuesta queda en ${proposal.contractedCredits} creditos por ${formatCurrency(proposal.quotedPrice, proposal.currency.toUpperCase())}.`,
    });
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos validar el cupon.") },
      { status: 400 },
    );
  }
}
