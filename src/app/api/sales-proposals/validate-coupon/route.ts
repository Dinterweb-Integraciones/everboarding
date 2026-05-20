import { NextResponse } from "next/server";

import { isAllowedDinterwebUser } from "@/lib/auth-domain";
import { getActiveSalesCouponByCode } from "@/lib/sales-proposals-server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatCurrency, formatUserError, safeParseNumber } from "@/lib/utils";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      code?: string;
      workspaceVariant?: "hubspot" | "dinterweb";
    };

    if (body.workspaceVariant === "dinterweb") {
      const supabase = await createSupabaseServerClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user || !isAllowedDinterwebUser(user)) {
        return NextResponse.json(
          { message: "Necesitas iniciar sesion con tu correo de Dinterweb." },
          { status: 401 },
        );
      }
    }

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

    return NextResponse.json({
      ok: true,
      coupon: {
        code: coupon.code,
        grantedCredits: Math.max(0, safeParseNumber(coupon.granted_credits)),
        discountedPrice: Math.max(0, safeParseNumber(coupon.discounted_price)),
      },
      message: `Cupon valido: ${Math.max(0, safeParseNumber(coupon.granted_credits))} creditos por ${formatCurrency(Math.max(0, safeParseNumber(coupon.discounted_price)))}.`,
    });
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos validar el cupon.") },
      { status: 400 },
    );
  }
}
