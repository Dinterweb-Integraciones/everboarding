import { SalesProposalAssignmentsManager } from "@/components/cs/sales-proposal-assignments-manager";
import { requireUser } from "@/lib/auth";
import type { AssignableUser } from "@/lib/onboarding";
import { mapSalesProposalRow, type SalesProposalRecord } from "@/lib/sales-proposals";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SalesAssignmentsPage() {
  const { supabase } = await requireUser();
  const admin = createSupabaseAdminClient();

  const [
    { data: proposalRows, error: proposalsError },
    { data: assignableProfiles, error: profilesError },
    { data: sellerProfiles, error: sellerProfilesError },
  ] = await Promise.all([
    admin
      .from("sales_proposals")
      .select("*")
      .neq("status", "transfer_pending")
      .order("updated_at", { ascending: false }),
    supabase.rpc("list_assignable_profiles"),
    admin
      .from("profiles")
      .select("id, email, full_name")
      .in("platform_role", ["sales", "superadmin"])
      .eq("is_platform_active", true)
      .order("full_name")
      .order("email"),
  ]);

  if (proposalsError) {
    throw new Error("No pudimos cargar las ventas del equipo comercial.");
  }

  if (profilesError) {
    console.error("cs_sales_assignable_profiles_load_failed", profilesError);
  }

  if (sellerProfilesError) {
    console.error("cs_sales_seller_profiles_load_failed", sellerProfilesError);
  }

  return (
    <SalesProposalAssignmentsManager
      initialProposals={((proposalRows ?? []) as Database["public"]["Tables"]["sales_proposals"]["Row"][]).map(
        (proposal) => mapSalesProposalRow(proposal),
      ) as SalesProposalRecord[]}
      assignableUsers={(assignableProfiles ?? []) as AssignableUser[]}
      sellerUsers={(sellerProfiles ?? []) as AssignableUser[]}
    />
  );
}
