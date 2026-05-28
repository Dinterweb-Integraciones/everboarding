import { SalesProposalWorkspace } from "@/components/sales/sales-proposal-workspace";
import { requireUser } from "@/lib/auth";
import { getDinterwebSellerIdentity } from "@/lib/dinterweb-sellers";
import type {
  CreditCatalogGroup,
  CreditCatalogGroupCategory,
  CreditCatalogGroupCategoryLink,
  CreditCatalogGroupItem,
  CreditCatalogItem,
} from "@/lib/onboarding";
import { getSalesProposalMutationAccess } from "@/lib/sales-proposal-access";
import { resolveLiveSalesProposalRecord } from "@/lib/sales-proposal-live-view";
import { createDuplicatedSalesProposalDraft, type SalesProposalDraft } from "@/lib/sales-proposals";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type NewDinterwebSalesProposalPageProps = {
  searchParams?: Promise<{ duplicateFrom?: string }>;
};

export default async function NewDinterwebSalesProposalPage({
  searchParams,
}: NewDinterwebSalesProposalPageProps) {
  const { user } = await requireUser("/sales/dinterweb");
  const seller = getDinterwebSellerIdentity(user);
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const duplicateFromSlug = resolvedSearchParams?.duplicateFrom?.trim() || "";
  let catalogRows: CreditCatalogItem[] = [];
  let groupRows: CreditCatalogGroup[] = [];
  let groupCategoryRows: CreditCatalogGroupCategory[] = [];
  let groupCategoryLinkRows: CreditCatalogGroupCategoryLink[] = [];
  let membershipRows: CreditCatalogGroupItem[] = [];
  let initialProposal: SalesProposalDraft | null = null;

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
      admin.from("credit_catalog_group_category_links").select("*").order("category_id").order("sort_order").order("created_at"),
      admin.from("credit_catalog_group_items").select("*").order("sort_order").order("created_at"),
    ]);

    if (catalogError) {
      console.error("dinterweb_sales_new_catalog_load_failed", catalogError);
    }

    if (groupsError) {
      console.error("dinterweb_sales_new_groups_load_failed", groupsError);
    }

    if (groupCategoriesError) {
      console.error("dinterweb_sales_new_group_categories_load_failed", groupCategoriesError);
    }

    if (groupCategoryLinksError) {
      console.error("dinterweb_sales_new_group_category_links_load_failed", groupCategoryLinksError);
    }

    if (membershipsError) {
      console.error("dinterweb_sales_new_group_memberships_load_failed", membershipsError);
    }

    catalogRows = fetchedCatalog ?? [];
    groupRows = fetchedGroups ?? [];
    groupCategoryRows = fetchedGroupCategories ?? [];
    groupCategoryLinkRows = fetchedGroupCategoryLinks ?? [];
    membershipRows = fetchedMemberships ?? [];

  } catch (error) {
    console.error("dinterweb_sales_new_workspace_bootstrap_failed", error);
    catalogRows = [];
    groupRows = [];
    groupCategoryRows = [];
    groupCategoryLinkRows = [];
    membershipRows = [];
  }

  if (duplicateFromSlug) {
    try {
      const proposalAccess = await getSalesProposalMutationAccess(duplicateFromSlug);

      if (!proposalAccess.ok) {
        throw new Error(proposalAccess.message);
      }

      if (proposalAccess.proposal.workspaceVariant !== "dinterweb") {
        throw new Error("Solo puedes duplicar propuestas de Dinterweb desde esta vista.");
      }

      initialProposal = createDuplicatedSalesProposalDraft(
        await resolveLiveSalesProposalRecord(proposalAccess.proposal),
      );
    } catch (error) {
      console.error("dinterweb_sales_duplicate_template_load_failed", {
        duplicateFromSlug,
        error,
      });
      initialProposal = null;
    }
  }

  return (
    <SalesProposalWorkspace
      initialCatalog={catalogRows}
      initialGroups={groupRows}
      initialGroupCategories={groupCategoryRows}
      initialGroupCategoryLinks={groupCategoryLinkRows}
      initialGroupMemberships={membershipRows}
      initialProposal={initialProposal}
      variant="dinterweb"
      routeBase="/sales/dinterweb/proposals"
      sellerPreset={seller}
    />
  );
}
