import { notFound } from "next/navigation";

import { SalesProposalWorkspace } from "@/components/sales/sales-proposal-workspace";
import { requireUser } from "@/lib/auth";
import { getDinterwebSellerIdentity } from "@/lib/dinterweb-sellers";
import { canManagePlatformUsers } from "@/lib/platform-access";
import type {
  CreditCatalogGroup,
  CreditCatalogGroupCategory,
  CreditCatalogGroupCategoryLink,
  CreditCatalogGroupItem,
  CreditCatalogItem,
} from "@/lib/onboarding";
import { getSalesProposalBySlug } from "@/lib/sales-proposal-access";
import type { SalesProposalRecord } from "@/lib/sales-proposals";
import { syncSalesProposalCheckoutStatus } from "@/lib/sales-proposals-server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type DinterwebSalesProposalPageProps = {
  params: Promise<{ slug: string }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DinterwebSalesProposalPage({
  params,
}: DinterwebSalesProposalPageProps) {
  const { user, platformProfile } = await requireUser("/sales/dinterweb");
  const seller = getDinterwebSellerIdentity(user);
  const isGlobalView = canManagePlatformUsers(platformProfile?.platform_role ?? null);
  const { slug } = await params;
  let initialProposal: SalesProposalRecord | null = null;
  let catalogRows: CreditCatalogItem[] = [];
  let groupRows: CreditCatalogGroup[] = [];
  let groupCategoryRows: CreditCatalogGroupCategory[] = [];
  let groupCategoryLinkRows: CreditCatalogGroupCategoryLink[] = [];
  let membershipRows: CreditCatalogGroupItem[] = [];

  try {
    const admin = createSupabaseAdminClient();
    const storedProposal = await getSalesProposalBySlug(slug);

    if (!storedProposal) {
      notFound();
    }

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

    if (groupCategoryLinksError) {
      console.error("dinterweb_sales_proposal_group_category_links_load_failed", {
        slug,
        error: groupCategoryLinksError,
      });
    }

    if (membershipsError) {
      console.error("dinterweb_sales_proposal_group_memberships_load_failed", {
        slug,
        error: membershipsError,
      });
    }

    initialProposal =
      storedProposal.proposal.status === "checkout_pending"
        ? await syncSalesProposalCheckoutStatus(slug)
        : storedProposal.proposal;
    catalogRows = fetchedCatalog ?? [];
    groupRows = fetchedGroups ?? [];
    groupCategoryRows = fetchedGroupCategories ?? [];
    groupCategoryLinkRows = fetchedGroupCategoryLinks ?? [];
    membershipRows = fetchedMemberships ?? [];
  } catch (error) {
    console.error("dinterweb_sales_proposal_workspace_bootstrap_failed", { slug, error });
    initialProposal = null;
  }

  if (!initialProposal) {
    notFound();
  }

  if (
    initialProposal.workspaceVariant !== "dinterweb" ||
    (!isGlobalView &&
      initialProposal.sellerEmail.trim() &&
      initialProposal.sellerEmail.trim().toLowerCase() !== seller.email)
  ) {
    notFound();
  }

  return (
    <SalesProposalWorkspace
      initialCatalog={catalogRows ?? []}
      initialGroups={groupRows ?? []}
      initialGroupCategories={groupCategoryRows ?? []}
      initialGroupCategoryLinks={groupCategoryLinkRows ?? []}
      initialGroupMemberships={membershipRows ?? []}
      initialProposal={initialProposal}
      variant="dinterweb"
      routeBase="/sales/dinterweb/proposals"
      sellerPreset={seller}
    />
  );
}
