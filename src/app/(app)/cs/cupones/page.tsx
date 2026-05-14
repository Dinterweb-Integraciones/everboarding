import { SalesCouponsManager } from "@/components/cs/sales-coupons-manager";
import { requireUser } from "@/lib/auth";
import type { Database } from "@/types/database";

type SalesCoupon = Database["public"]["Tables"]["sales_coupons"]["Row"];

export default async function SalesCouponsPage() {
  const { supabase } = await requireUser();

  const { data, error } = await supabase
    .from("sales_coupons")
    .select("*")
    .order("created_at", { ascending: false })
    .order("code", { ascending: true });

  if (error) {
    throw new Error("No pudimos cargar el catalogo de cupones.");
  }

  return <SalesCouponsManager initialCoupons={(data ?? []) as SalesCoupon[]} />;
}
