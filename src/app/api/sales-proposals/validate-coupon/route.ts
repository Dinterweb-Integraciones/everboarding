import { NextResponse } from "next/server";

import { getActiveSalesCouponByCode } from "@/lib/sales-proposals-server";
import { formatUserError } from "@/lib/utils";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      code?: string;
    };
    const code = body.code?.trim() || "";

    if (!code) {
      return NextResponse.json(
        { message: "Ingresa un cupon antes de intentar canjearlo." },
        { status: 400 },
      );
    }

    const coupon = await getActiveSalesCouponByCode(code);

    if (!coupon) {
      return NextResponse.json(
        { message: "El cupon no existe o ya no esta activo." },
        { status: 400 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos validar el cupon.") },
      { status: 400 },
    );
  }
}
