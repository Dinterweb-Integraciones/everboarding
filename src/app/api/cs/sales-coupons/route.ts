import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { normalizeCouponPercentageOff, normalizeSalesCouponType } from "@/lib/sales-proposals";
import { createSalesCoupon } from "@/lib/sales-proposals-server";
import { formatUserError, safeParseNumber } from "@/lib/utils";

export async function POST(request: Request) {
  try {
    await requireUser();

    const body = (await request.json()) as {
      code?: string;
      couponType?: string;
      grantedCredits?: number;
      discountedPrice?: number;
      percentageOff?: number | null;
    };

    const coupon = await createSalesCoupon({
      code: body.code ?? "",
      couponType: normalizeSalesCouponType(body.couponType),
      grantedCredits: Math.max(0, Math.round(safeParseNumber(body.grantedCredits))),
      discountedPrice: Math.max(0, safeParseNumber(body.discountedPrice)),
      percentageOff:
        body.percentageOff === null || body.percentageOff === undefined
          ? null
          : normalizeCouponPercentageOff(body.percentageOff),
    });

    return NextResponse.json(coupon);
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos crear el cupon.") },
      { status: 400 },
    );
  }
}
