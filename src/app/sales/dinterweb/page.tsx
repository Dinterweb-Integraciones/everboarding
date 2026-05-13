import { DinterwebSellerDashboard } from "@/components/sales/dinterweb-seller-dashboard";
import { requireUser } from "@/lib/auth";
import { getDinterwebSellerIdentity } from "@/lib/dinterweb-sellers";
import { mapSalesProposalRow, type SalesProposalRecord } from "@/lib/sales-proposals";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";

type SalesProposalRow = Database["public"]["Tables"]["sales_proposals"]["Row"];

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DinterwebSalesIndexPage() {
  const { user } = await requireUser("/sales/dinterweb");
  const seller = getDinterwebSellerIdentity(user);
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("sales_proposals")
    .select("*")
    .eq("seller_email", seller.email)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error("No pudimos cargar tus propuestas de Dinterweb.");
  }

  const proposals = ((data ?? []) as SalesProposalRow[])
    .map((row) => mapSalesProposalRow(row))
    .filter((proposal) => proposal.workspaceVariant === "dinterweb") as SalesProposalRecord[];

  return <DinterwebSellerDashboard sellerName={seller.name} proposals={proposals} />;
}
