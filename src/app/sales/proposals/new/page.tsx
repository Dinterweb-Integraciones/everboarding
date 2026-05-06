import { SalesProposalWorkspace } from "@/components/sales/sales-proposal-workspace";
import type {
  AssignableUser,
  CreditCatalogGroup,
  CreditCatalogGroupItem,
  CreditCatalogItem,
} from "@/lib/onboarding";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function NewSalesProposalPage() {
  let catalogRows: CreditCatalogItem[] = [];
  let groupRows: CreditCatalogGroup[] = [];
  let membershipRows: CreditCatalogGroupItem[] = [];
  let profileRows: AssignableUser[] = [];

  try {
    const admin = createSupabaseAdminClient();
    const [
      { data: fetchedCatalog, error: catalogError },
      { data: fetchedGroups, error: groupsError },
      { data: fetchedMemberships, error: membershipsError },
      { data: fetchedProfiles, error: profilesError },
    ] = await Promise.all([
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

    if (catalogError) {
      console.error("sales_new_catalog_load_failed", catalogError);
    }

    if (groupsError) {
      console.error("sales_new_groups_load_failed", groupsError);
    }

    if (membershipsError) {
      console.error("sales_new_group_memberships_load_failed", membershipsError);
    }

    if (profilesError) {
      console.error("sales_new_profiles_load_failed", profilesError);
    }

    catalogRows = fetchedCatalog ?? [];
    groupRows = fetchedGroups ?? [];
    membershipRows = fetchedMemberships ?? [];
    profileRows = fetchedProfiles ?? [];
  } catch (error) {
    console.error("sales_new_workspace_bootstrap_failed", error);
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
