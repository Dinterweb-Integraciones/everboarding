import { notFound } from "next/navigation";

import { SalesProposalWorkspace } from "@/components/sales/sales-proposal-workspace";
import type {
  CreditCatalogGroup,
  CreditCatalogGroupCategory,
  CreditCatalogGroupCategoryLink,
  CreditCatalogGroupItem,
  CreditCatalogItem,
} from "@/lib/onboarding";
import { getSalesProposalBySlug } from "@/lib/sales-proposal-access";
import { mapSalesProposalRow } from "@/lib/sales-proposals";
import { syncSalesProposalCheckoutStatus } from "@/lib/sales-proposals-server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";

type SalesProposalPageProps = {
  params: Promise<{ slug: string }>;
};

type SalesProposalRow = Database["public"]["Tables"]["sales_proposals"]["Row"];

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SalesProposalPage({ params }: SalesProposalPageProps) {
  const { slug } = await params;
  let proposalRow: SalesProposalRow | null = null;
  let catalogRows: CreditCatalogItem[] = [];
  let groupRows: CreditCatalogGroup[] = [];
  let groupCategoryRows: CreditCatalogGroupCategory[] = [];
  let groupCategoryLinkRows: CreditCatalogGroupCategoryLink[] = [];
  let membershipRows: CreditCatalogGroupItem[] = [];

  try {
    const admin = createSupabaseAdminClient();
    const storedProposal = await getSalesProposalBySlug(slug);

    if (!storedProposal || storedProposal.proposal.workspaceVariant !== "hubspot") {
      notFound();
    }

    proposalRow = storedProposal.proposalRow;
    const [
      { data: fetchedCatalog, error: catalogError },
      { data: fetchedGroups, error: groupsError },
      { data: fetchedGroupCategories, error: groupCategoriesError },
      { data: fetchedGroupCategoryLinks, error: groupCategoryLinksError },
      { data: fetchedMemberships, error: membershipsError },
    ] =
      await Promise.all([
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
      console.error("sales_proposal_catalog_load_failed", { slug, error: catalogError });
    }

    if (groupsError) {
      console.error("sales_proposal_groups_load_failed", { slug, error: groupsError });
    }

    if (groupCategoriesError) {
      console.error("sales_proposal_group_categories_load_failed", { slug, error: groupCategoriesError });
    }

    if (groupCategoryLinksError) {
      console.error("sales_proposal_group_category_links_load_failed", { slug, error: groupCategoryLinksError });
    }

    if (membershipsError) {
      console.error("sales_proposal_group_memberships_load_failed", { slug, error: membershipsError });
    }
    catalogRows = fetchedCatalog ?? [];
    groupRows = fetchedGroups ?? [];
    groupCategoryRows = fetchedGroupCategories ?? [];
    groupCategoryLinkRows = fetchedGroupCategoryLinks ?? [];
    membershipRows = fetchedMemberships ?? [];
  } catch (error) {
    console.error("sales_proposal_workspace_bootstrap_failed", { slug, error });
    proposalRow = null;
  }

  if (!proposalRow) {
    notFound();
  }

  const typedProposalRow: SalesProposalRow = proposalRow;
  const initialProposal =
    typedProposalRow.status === "checkout_pending"
      ? await syncSalesProposalCheckoutStatus(slug)
      : mapSalesProposalRow(typedProposalRow);

  return (
    <SalesProposalWorkspace
      initialCatalog={catalogRows ?? []}
      initialGroups={groupRows ?? []}
      initialGroupCategories={groupCategoryRows ?? []}
      initialGroupCategoryLinks={groupCategoryLinkRows ?? []}
      initialGroupMemberships={membershipRows ?? []}
      initialProposal={initialProposal}
    />
  );
}
