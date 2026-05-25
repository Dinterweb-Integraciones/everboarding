import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { canAccessFinance } from "@/lib/platform-access";
import { confirmTransferredSalesProposalPayment } from "@/lib/sales-proposals-server";
import { formatUserError } from "@/lib/utils";

type ConfirmTransferPaymentRouteProps = {
  params: Promise<{ proposalId: string }>;
};

export async function PUT(request: Request, { params }: ConfirmTransferPaymentRouteProps) {
  try {
    const { proposalId } = await params;
    const { user, platformProfile } = await requireUser("/finanzas");
    const platformRole = platformProfile?.platform_role ?? null;

    if (!canAccessFinance(platformRole)) {
      return NextResponse.json(
        { message: "Solo Finanzas o un superadmin pueden confirmar transferencias." },
        { status: 403 },
      );
    }

    const body = (await request.json()) as {
      transferReference?: string;
    };

    const proposal = await confirmTransferredSalesProposalPayment(
      proposalId,
      body.transferReference ?? "",
      user.id,
    );

    return NextResponse.json(proposal);
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos confirmar el pago por transferencia.") },
      { status: 400 },
    );
  }
}
