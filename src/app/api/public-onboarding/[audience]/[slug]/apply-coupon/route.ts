import { NextResponse } from "next/server";

import { buildPublicProspectSnapshotBase, getSalesProposalBySlug } from "@/lib/public-prospect";
import { applySalesCouponToProposal } from "@/lib/sales-proposals-server";
import { formatCurrency, formatUserError } from "@/lib/utils";

type PublicApplyCouponRouteProps = {
  params: Promise<{ audience: string; slug: string }>;
};

export async function POST(request: Request, { params }: PublicApplyCouponRouteProps) {
  try {
    const { audience, slug } = await params;

    if (audience !== "prospect") {
      return NextResponse.json(
        { message: "Solo la vista publica del prospecto puede aplicar cupones." },
        { status: 400 },
      );
    }

    const currentProposal = await getSalesProposalBySlug(slug);

    if (!currentProposal) {
      return NextResponse.json(
        { message: "No encontramos la propuesta para aplicar el cupon." },
        { status: 404 },
      );
    }

    const body = (await request.json()) as { code?: string };
    const code = body.code?.trim() || "";

    if (!code) {
      return NextResponse.json(
        { message: "Ingresa un cupon antes de intentar canjearlo." },
        { status: 400 },
      );
    }

    const proposal = await applySalesCouponToProposal(slug, code);
    const snapshot = buildPublicProspectSnapshotBase(proposal);

    return NextResponse.json({
      config: snapshot.config,
      billing: snapshot.billing,
      prospectProposal: snapshot.prospectProposal,
      message:
        proposal.quotedPrice <= 0
          ? `Cupon aplicado. La propuesta queda en ${proposal.contractedCredits} creditos y ${formatCurrency(proposal.quotedPrice, proposal.currency.toUpperCase())}.`
          : `Cupon aplicado. La propuesta queda en ${proposal.contractedCredits} creditos por ${formatCurrency(proposal.quotedPrice, proposal.currency.toUpperCase())}.`,
    });
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos aplicar el cupon al prospecto.") },
      { status: 400 },
    );
  }
}
