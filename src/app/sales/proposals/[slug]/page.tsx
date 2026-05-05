import { notFound } from "next/navigation";

import { SalesProposalWorkspace } from "@/components/sales/sales-proposal-workspace";
import type {
  AssignableUser,
  CreditCatalogGroup,
  CreditCatalogGroupItem,
  CreditCatalogItem,
} from "@/lib/onboarding";
import { mapSalesProposalRow } from "@/lib/sales-proposals";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";

type SalesProposalPageProps = {
  params: Promise<{ slug: string }>;
};

export default async function SalesProposalPage({ params }: SalesProposalPageProps) {
  const { slug } = await params;
  let proposalRow: Database["public"]["Tables"]["sales_proposals"]["Row"] | null = null;
  let catalogRows: CreditCatalogItem[] = [];
  let groupRows: CreditCatalogGroup[] = [];
  let membershipRows: CreditCatalogGroupItem[] = [];
  let profileRows: AssignableUser[] = [];

  try {
    const admin = createSupabaseAdminClient();
    const [
      { data: fetchedProposal },
      { data: fetchedCatalog },
      { data: fetchedGroups },
      { data: fetchedMemberships },
      { data: fetchedProfiles },
    ] =
      await Promise.all([
        admin.from("sales_proposals").select("*").eq("slug", slug).maybeSingle(),
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

    proposalRow = fetchedProposal;
    catalogRows = fetchedCatalog ?? [];
    groupRows = fetchedGroups ?? [];
    membershipRows = fetchedMemberships ?? [];
    profileRows = fetchedProfiles ?? [];
  } catch {
    proposalRow = null;
  }

  if (!proposalRow) {
    notFound();
  }

  return (
    <SalesProposalWorkspace
      initialCatalog={catalogRows ?? []}
      initialGroups={groupRows ?? []}
      initialGroupMemberships={membershipRows ?? []}
      csmOptions={profileRows ?? []}
      initialProposal={mapSalesProposalRow(proposalRow)}
    />
  );
}
