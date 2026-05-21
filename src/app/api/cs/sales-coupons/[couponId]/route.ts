import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { normalizeCouponPercentageOff, normalizeSalesCouponType } from "@/lib/sales-proposals";
import { formatUserError, safeParseNumber } from "@/lib/utils";

type SalesCouponRouteProps = {
  params: Promise<{ couponId: string }>;
};

export async function PUT(request: Request, { params }: SalesCouponRouteProps) {
  try {
    const { couponId } = await params;
    const { supabase } = await requireUser();
    const body = (await request.json()) as {
      code?: string;
      couponType?: string;
      grantedCredits?: number;
      discountedPrice?: number;
      percentageOff?: number | null;
      isActive?: boolean;
    };

    const code = body.code?.trim().toUpperCase();
    const couponType = normalizeSalesCouponType(body.couponType);
    const grantedCredits = Math.max(0, Math.round(safeParseNumber(body.grantedCredits)));
    const discountedPrice = Math.max(0, safeParseNumber(body.discountedPrice));
    const percentageOff =
      body.percentageOff === null || body.percentageOff === undefined
        ? null
        : normalizeCouponPercentageOff(body.percentageOff);
    const isActive = body.isActive ?? true;

    if (!code) {
      return NextResponse.json({ message: "El codigo del cupon es requerido." }, { status: 400 });
    }

    if (couponType === "package_override" && grantedCredits <= 0) {
      return NextResponse.json({ message: "Los creditos deben ser mayores a 0." }, { status: 400 });
    }

    if (couponType === "percentage" && (!percentageOff || percentageOff <= 0)) {
      return NextResponse.json({ message: "El porcentaje debe ser mayor a 0." }, { status: 400 });
    }

    const { data: duplicateCoupon, error: duplicateError } = await supabase
      .from("sales_coupons")
      .select("id")
      .ilike("code", code)
      .neq("id", couponId)
      .maybeSingle();

    if (duplicateError) throw duplicateError;

    if (duplicateCoupon) {
      return NextResponse.json({ message: "Ya existe un cupon con ese codigo." }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("sales_coupons")
      .update({
        code,
        coupon_type: couponType,
        granted_credits: couponType === "package_override" ? grantedCredits : 0,
        discounted_price: couponType === "package_override" ? discountedPrice : 0,
        percentage_off: couponType === "percentage" ? percentageOff : null,
        is_active: isActive,
      })
      .eq("id", couponId)
      .select("*")
      .single();

    if (error) throw error;

    return NextResponse.json(data);
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos actualizar el cupon.") },
      { status: 400 },
    );
  }
}

export async function DELETE(_: Request, { params }: SalesCouponRouteProps) {
  try {
    const { couponId } = await params;
    const { supabase } = await requireUser();

    const { error } = await supabase.from("sales_coupons").delete().eq("id", couponId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos eliminar el cupon.") },
      { status: 400 },
    );
  }
}
