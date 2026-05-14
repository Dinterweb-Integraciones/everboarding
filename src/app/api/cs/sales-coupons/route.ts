import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { createSalesCoupon } from "@/lib/sales-proposals-server";
import { formatUserError, safeParseNumber } from "@/lib/utils";

export async function POST(request: Request) {
  try {
    await requireUser();

    const body = (await request.json()) as {
      code?: string;
      grantedCredits?: number;
      discountedPrice?: number;
    };

    const coupon = await createSalesCoupon({
      code: body.code ?? "",
      grantedCredits: Math.max(0, Math.round(safeParseNumber(body.grantedCredits))),
      discountedPrice: Math.max(0, safeParseNumber(body.discountedPrice)),
    });

    return NextResponse.json(coupon);
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos crear el cupon.") },
      { status: 400 },
    );
  }
}
