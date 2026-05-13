import { notFound } from "next/navigation";

import { SalesProposalWorkspace } from "@/components/sales/sales-proposal-workspace";
import { requireUser } from "@/lib/auth";
import { getDinterwebSellerIdentity } from "@/lib/dinterweb-sellers";
import type {
  CreditCatalogGroup,
  CreditCatalogGroupCategory,
  CreditCatalogGroupItem,
  CreditCatalogItem,
} from "@/lib/onboarding";
import { mapSalesProposalRow } from "@/lib/sales-proposals";
import { syncSalesProposalCheckoutStatus } from "@/lib/sales-proposals-server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";

type DinterwebSalesProposalPageProps = {
  params: Promise<{ slug: string }>;
};

type SalesProposalRow = Database["public"]["Tables"]["sales_proposals"]["Row"];

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DinterwebSalesProposalPage({
  params,
}: DinterwebSalesProposalPageProps) {
  const { user } = await requireUser("/sales/dinterweb");
  const seller = getDinterwebSellerIdentity(user);
  const { slug } = await params;
  let proposalRow: SalesProposalRow | null = null;
  let catalogRows: CreditCatalogItem[] = [];
  let groupRows: CreditCatalogGroup[] = [];
  let groupCategoryRows: CreditCatalogGroupCategory[] = [];
  let membershipRows: CreditCatalogGroupItem[] = [];

  try {
    const admin = createSupabaseAdminClient();
    const [
      { data: fetchedProposal, error: proposalError },
      { data: fetchedCatalog, error: catalogError },
      { data: fetchedGroups, error: groupsError },
      { data: fetchedGroupCategories, error: groupCategoriesError },
      { data: fetchedMemberships, error: membershipsError },
    ] = await Promise.all([
      admin.from("sales_proposals").select("*").eq("slug", slug).maybeSingle(),
      admin
        .from("credit_catalog_items")
        .select("*")
        .eq("is_active", true)
        .order("category")
        .order("sort_order"),
      admin.from("credit_catalog_groups").select("*").eq("is_active", true).order("sort_order").order("name"),
      admin.from("credit_catalog_group_categories").select("*").order("sort_order").order("name"),
      admin.from("credit_catalog_group_items").select("*").order("sort_order").order("created_at"),
    ]);

    if (proposalError) {
      console.error("dinterweb_sales_proposal_load_failed", { slug, error: proposalError });
    }

    if (catalogError) {
      console.error("dinterweb_sales_proposal_catalog_load_failed", { slug, error: catalogError });
    }

    if (groupsError) {
      console.error("dinterweb_sales_proposal_groups_load_failed", { slug, error: groupsError });
    }

    if (groupCategoriesError) {
      console.error("dinterweb_sales_proposal_group_categories_load_failed", {
        slug,
        error: groupCategoriesError,
      });
    }

    if (membershipsError) {
      console.error("dinterweb_sales_proposal_group_memberships_load_failed", {
        slug,
        error: membershipsError,
      });
    }

    proposalRow = (fetchedProposal as SalesProposalRow | null) ?? null;
    catalogRows = fetchedCatalog ?? [];
    groupRows = fetchedGroups ?? [];
    groupCategoryRows = fetchedGroupCategories ?? [];
    membershipRows = fetchedMemberships ?? [];
  } catch (error) {
    console.error("dinterweb_sales_proposal_workspace_bootstrap_failed", { slug, error });
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

  if (
    initialProposal.workspaceVariant !== "dinterweb" ||
    (initialProposal.sellerEmail.trim() &&
      initialProposal.sellerEmail.trim().toLowerCase() !== seller.email)
  ) {
    notFound();
  }

  return (
    <SalesProposalWorkspace
      initialCatalog={catalogRows ?? []}
      initialGroups={groupRows ?? []}
      initialGroupCategories={groupCategoryRows ?? []}
      initialGroupMemberships={membershipRows ?? []}
      initialProposal={initialProposal}
      variant="dinterweb"
      routeBase="/sales/dinterweb/proposals"
      sellerPreset={seller}
    />
  );
}
