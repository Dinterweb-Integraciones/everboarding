import { NextResponse } from "next/server";

import { buildPublicProspectSnapshotBase, getSalesProposalBySlug } from "@/lib/public-prospect";
import { setSalesProposalExtraPackages } from "@/lib/sales-proposals";
import { saveSalesProposal } from "@/lib/sales-proposals-server";
import { PUBLIC_EXTRA_CREDIT_PACKAGE } from "@/lib/constants";
import { formatCurrency, formatUserError } from "@/lib/utils";

type PublicExtraPackagesRouteProps = {
  params: Promise<{ audience: string; slug: string }>;
};

export async function POST(request: Request, { params }: PublicExtraPackagesRouteProps) {
  try {
    const { audience, slug } = await params;

    if (audience !== "prospect") {
      return NextResponse.json(
        { message: "Solo la vista publica del prospecto puede ajustar paquetes extra." },
        { status: 400 },
      );
    }

    const currentProposal = await getSalesProposalBySlug(slug);

    if (!currentProposal) {
      return NextResponse.json(
        { message: "No encontramos la propuesta para ajustar los paquetes extra." },
        { status: 404 },
      );
    }

    const body = (await request.json()) as { quantity?: number };
    const quantity = Math.max(0, Math.floor(Number(body.quantity ?? 0) || 0));
    if (
      currentProposal.status === "checkout_pending" ||
      currentProposal.status === "paid" ||
      currentProposal.status === "board_activated"
    ) {
      return NextResponse.json(
        { message: "Los paquetes extra solo se pueden ajustar antes de iniciar el checkout." },
        { status: 400 },
      );
    }

    const updatedDraft = setSalesProposalExtraPackages(
      currentProposal,
      PUBLIC_EXTRA_CREDIT_PACKAGE,
      quantity,
    );
    const proposal = await saveSalesProposal(updatedDraft, slug);
    const snapshot = buildPublicProspectSnapshotBase(proposal);

    return NextResponse.json({
      config: snapshot.config,
      billing: snapshot.billing,
      prospectProposal: snapshot.prospectProposal,
      message:
        quantity > 0
          ? `La propuesta ahora queda en ${proposal.contractedCredits} creditos por ${formatCurrency(proposal.quotedPrice, proposal.currency.toUpperCase())}.`
          : "La propuesta volvio al plan original sin paquetes extra.",
    });
  } catch (caughtError) {
    return NextResponse.json(
      {
        message: formatUserError(
          caughtError,
          "No pudimos actualizar los paquetes extra del prospecto.",
        ),
      },
      { status: 400 },
    );
  }
}
