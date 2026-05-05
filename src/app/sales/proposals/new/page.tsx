import { SalesProposalWorkspace } from "@/components/sales/sales-proposal-workspace";
import type {
  AssignableUser,
  CreditCatalogGroup,
  CreditCatalogGroupItem,
  CreditCatalogItem,
} from "@/lib/onboarding";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export default async function NewSalesProposalPage() {
  let catalogRows: CreditCatalogItem[] = [];
  let groupRows: CreditCatalogGroup[] = [];
  let membershipRows: CreditCatalogGroupItem[] = [];
  let profileRows: AssignableUser[] = [];

  try {
    const admin = createSupabaseAdminClient();
    const [{ data: fetchedCatalog }, { data: fetchedGroups }, { data: fetchedMemberships }, { data: fetchedProfiles }] = await Promise.all([
      admin
        .from("credit_catalog_items")
        .select("*")
        .eq("is_active", true)
        .order("category")
        .order("sort_order"),
      admin.from("credit_catalog_groups").select("*").eq("is_active", true).order("sort_order").order("name"),
      admin.from("credit_catalog_group_items").select("*").order("sort_order").order("created_at"),
      admin.from("profiles").select("id, email, full_name").order("full_name"),
    ]);

    catalogRows = fetchedCatalog ?? [];
    groupRows = fetchedGroups ?? [];
    membershipRows = fetchedMemberships ?? [];
    profileRows = fetchedProfiles ?? [];
  } catch {
    catalogRows = [];
    groupRows = [];
    membershipRows = [];
    profileRows = [];
  }

  return (
    <SalesProposalWorkspace
      initialCatalog={catalogRows}
      initialGroups={groupRows}
      initialGroupMemberships={membershipRows}
      csmOptions={profileRows}
      initialProposal={null}
    />
  );
}
