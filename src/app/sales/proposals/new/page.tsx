import { SalesProposalWorkspace } from "@/components/sales/sales-proposal-workspace";
import type {
  CreditCatalogGroup,
  CreditCatalogGroupCategory,
  CreditCatalogGroupCategoryLink,
  CreditCatalogGroupItem,
  CreditCatalogItem,
} from "@/lib/onboarding";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function NewSalesProposalPage() {
  let catalogRows: CreditCatalogItem[] = [];
  let groupRows: CreditCatalogGroup[] = [];
  let groupCategoryRows: CreditCatalogGroupCategory[] = [];
  let groupCategoryLinkRows: CreditCatalogGroupCategoryLink[] = [];
  let membershipRows: CreditCatalogGroupItem[] = [];

  try {
    const admin = createSupabaseAdminClient();
    const [
      { data: fetchedCatalog, error: catalogError },
      { data: fetchedGroups, error: groupsError },
      { data: fetchedGroupCategories, error: groupCategoriesError },
      { data: fetchedGroupCategoryLinks, error: groupCategoryLinksError },
      { data: fetchedMemberships, error: membershipsError },
    ] = await Promise.all([
      admin
        .from("credit_catalog_items")
        .select("*")
        .eq("is_active", true)
        .order("category")
        .order("sort_order"),
      admin.from("credit_catalog_groups").select("*").eq("is_active", true).order("sort_order").order("name"),
      admin.from("credit_catalog_group_categories").select("*").order("sort_order").order("name"),
      admin.from("credit_catalog_group_category_links").select("*").order("created_at"),
      admin.from("credit_catalog_group_items").select("*").order("sort_order").order("created_at"),
    ]);

    if (catalogError) {
      console.error("sales_new_catalog_load_failed", catalogError);
    }

    if (groupsError) {
      console.error("sales_new_groups_load_failed", groupsError);
    }

    if (groupCategoriesError) {
      console.error("sales_new_group_categories_load_failed", groupCategoriesError);
    }

    if (groupCategoryLinksError) {
      console.error("sales_new_group_category_links_load_failed", groupCategoryLinksError);
    }

    if (membershipsError) {
      console.error("sales_new_group_memberships_load_failed", membershipsError);
    }

    catalogRows = fetchedCatalog ?? [];
    groupRows = fetchedGroups ?? [];
    groupCategoryRows = fetchedGroupCategories ?? [];
    groupCategoryLinkRows = fetchedGroupCategoryLinks ?? [];
    membershipRows = fetchedMemberships ?? [];
  } catch (error) {
    console.error("sales_new_workspace_bootstrap_failed", error);
    catalogRows = [];
    groupRows = [];
    groupCategoryRows = [];
    groupCategoryLinkRows = [];
    membershipRows = [];
  }

  return (
    <SalesProposalWorkspace
      initialCatalog={catalogRows}
      initialGroups={groupRows}
      initialGroupCategories={groupCategoryRows}
      initialGroupCategoryLinks={groupCategoryLinkRows}
      initialGroupMemberships={membershipRows}
      initialProposal={null}
    />
  );
}
