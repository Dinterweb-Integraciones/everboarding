import { redirect } from "next/navigation";

import { FinanceTransferPaymentsManager } from "@/components/finance/finance-transfer-payments-manager";
import { requireUser } from "@/lib/auth";
import { canAccessFinance } from "@/lib/platform-access";
import { mapSalesProposalRow, type SalesProposalRecord } from "@/lib/sales-proposals";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function FinanceTransfersPage() {
  const { platformProfile } = await requireUser("/finanzas");
  const platformRole = platformProfile?.platform_role ?? null;

  if (!canAccessFinance(platformRole)) {
    redirect("/dashboard");
  }

  const admin = createSupabaseAdminClient();
  const { data: proposalRows, error } = await admin
    .from("sales_proposals")
    .select("*")
    .eq("payment_method", "bank_transfer")
    .eq("status", "transfer_pending")
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error("No pudimos cargar las transferencias pendientes.");
  }

  return (
    <FinanceTransferPaymentsManager
      initialProposals={((proposalRows ?? []) as Database["public"]["Tables"]["sales_proposals"]["Row"][]).map(
        (proposal) => mapSalesProposalRow(proposal),
      ) as SalesProposalRecord[]}
    />
  );
}
