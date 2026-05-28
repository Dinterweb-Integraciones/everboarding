import { DinterwebSellerDashboard } from "@/components/sales/dinterweb-seller-dashboard";
import { requireUser } from "@/lib/auth";
import { getDinterwebSellerIdentity } from "@/lib/dinterweb-sellers";
import { canManagePlatformUsers } from "@/lib/platform-access";
import { resolveLiveSalesProposalRecords } from "@/lib/sales-proposal-live-view";
import { mapSalesProposalRow, type SalesProposalRecord } from "@/lib/sales-proposals";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";

type SalesProposalRow = Database["public"]["Tables"]["sales_proposals"]["Row"];

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DinterwebSalesIndexPage() {
  const { user, platformProfile } = await requireUser("/sales/dinterweb");
  const seller = getDinterwebSellerIdentity(user);
  const isGlobalView = canManagePlatformUsers(platformProfile?.platform_role ?? null);
  const admin = createSupabaseAdminClient();
  let query = admin.from("sales_proposals").select("*").order("updated_at", { ascending: false });

  if (!isGlobalView) {
    query = query.eq("seller_email", seller.email);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error("No pudimos cargar tus propuestas de Dinterweb.");
  }

  const proposals = ((data ?? []) as SalesProposalRow[])
    .map((row) => mapSalesProposalRow(row))
    .filter((proposal) => proposal.workspaceVariant === "dinterweb") as SalesProposalRecord[];
  const liveProposals = await resolveLiveSalesProposalRecords(proposals);

  return (
    <DinterwebSellerDashboard
      sellerName={seller.name}
      proposals={liveProposals}
      isGlobalView={isGlobalView}
    />
  );
}
