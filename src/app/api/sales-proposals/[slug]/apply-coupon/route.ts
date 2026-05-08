import { NextResponse } from "next/server";

import { applySalesCouponToProposal } from "@/lib/sales-proposals-server";
import { formatUserError } from "@/lib/utils";

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
      message: "Cupon aplicado. La propuesta queda en 40 creditos, $0 y se activara sin pasarela.",
    });
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos validar el cupon.") },
      { status: 400 },
    );
  }
}
