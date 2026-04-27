import { SalesProposalWorkspace } from "@/components/sales/sales-proposal-workspace";
import type { AssignableUser, CreditCatalogItem } from "@/lib/onboarding";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export default async function NewSalesProposalPage() {
  let catalogRows: CreditCatalogItem[] = [];
  let profileRows: AssignableUser[] = [];

  try {
    const admin = createSupabaseAdminClient();
    const [{ data: fetchedCatalog }, { data: fetchedProfiles }] = await Promise.all([
      admin
        .from("credit_catalog_items")
        .select("*")
        .eq("is_active", true)
        .order("category")
        .order("sort_order"),
      admin.from("profiles").select("id, email, full_name").order("full_name"),
    ]);

    catalogRows = fetchedCatalog ?? [];
    profileRows = fetchedProfiles ?? [];
  } catch {
    catalogRows = [];
    profileRows = [];
  }

  return (
    <SalesProposalWorkspace
      initialCatalog={catalogRows}
      csmOptions={profileRows}
      initialProposal={null}
    />
  );
}
