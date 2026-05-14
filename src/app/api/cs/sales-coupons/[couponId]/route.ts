import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
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
      grantedCredits?: number;
      discountedPrice?: number;
      isActive?: boolean;
    };

    const code = body.code?.trim().toUpperCase();
    const grantedCredits = Math.max(0, Math.round(safeParseNumber(body.grantedCredits)));
    const discountedPrice = Math.max(0, safeParseNumber(body.discountedPrice));
    const isActive = body.isActive ?? true;

    if (!code) {
      return NextResponse.json({ message: "El codigo del cupon es requerido." }, { status: 400 });
    }

    if (grantedCredits <= 0) {
      return NextResponse.json({ message: "Los creditos deben ser mayores a 0." }, { status: 400 });
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
        granted_credits: grantedCredits,
        discounted_price: discountedPrice,
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
