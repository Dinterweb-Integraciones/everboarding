import { SalesCouponsManager } from "@/components/cs/sales-coupons-manager";
import { requireUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";

type SalesCoupon = Database["public"]["Tables"]["sales_coupons"]["Row"];

export default async function SalesCouponsPage() {
  await requireUser("/cs/cupones");
  const admin = createSupabaseAdminClient();

  const { data, error } = await admin
    .from("sales_coupons")
    .select("*")
    .order("created_at", { ascending: false })
    .order("code", { ascending: true });

  if (error) {
    throw new Error("No pudimos cargar el catalogo de cupones.");
  }

  return <SalesCouponsManager initialCoupons={(data ?? []) as SalesCoupon[]} />;
}
