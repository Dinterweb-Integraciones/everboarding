import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { canAccessFinance } from "@/lib/platform-access";
import { confirmTransferredSalesProposalRenewalPayment } from "@/lib/sales-proposals-server";
import { formatUserError } from "@/lib/utils";

type ConfirmTransferRenewalPaymentRouteProps = {
  params: Promise<{ proposalId: string }>;
};

export async function PUT(request: Request, { params }: ConfirmTransferRenewalPaymentRouteProps) {
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
      transferBank?: string;
      transferReference?: string;
      cycleStartDate?: string;
    };

    const result = await confirmTransferredSalesProposalRenewalPayment(
      proposalId,
      body.cycleStartDate ?? "",
      body.transferBank ?? "",
      body.transferReference ?? "",
      user.id,
    );

    return NextResponse.json(result);
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos confirmar la renovacion por transferencia.") },
      { status: 400 },
    );
  }
}
