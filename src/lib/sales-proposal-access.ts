import { isAllowedDinterwebUser } from "@/lib/auth-domain";
import { getDinterwebSellerIdentity } from "@/lib/dinterweb-sellers";
import { canManagePlatformUsers } from "@/lib/platform-access";
import { mapSalesProposalRow, type SalesProposalRecord } from "@/lib/sales-proposals";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isMissingSupabaseTable } from "@/lib/utils";
import type { Database } from "@/types/database";

type SalesProposalRow = Database["public"]["Tables"]["sales_proposals"]["Row"];
type SalesProposalSnapshotRow = Database["public"]["Tables"]["sales_proposal_snapshots"]["Row"];
type PlatformProfileRoleRow = Pick<Database["public"]["Tables"]["profiles"]["Row"], "platform_role">;

type SalesProposalAccessError = {
  ok: false;
  status: number;
  message: string;
};

type SalesProposalAccessSuccess = {
  ok: true;
  proposal: SalesProposalRecord;
  proposalRow: SalesProposalRow;
};

export type SalesProposalAccessResult = SalesProposalAccessError | SalesProposalAccessSuccess;

async function attachStoredSnapshot(proposalRow: SalesProposalRow) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("sales_proposal_snapshots")
    .select("snapshot")
    .eq("proposal_id", proposalRow.id)
    .maybeSingle();
  const snapshotRow = data as Pick<SalesProposalSnapshotRow, "snapshot"> | null;

  if (error && !isMissingSupabaseTable(error, "sales_proposal_snapshots")) {
    throw error;
  }

  return snapshotRow?.snapshot
    ? ({
        ...proposalRow,
        snapshot: snapshotRow.snapshot,
      } as SalesProposalRow)
    : proposalRow;
}

export async function getSalesProposalBySlug(slug: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("sales_proposals")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const proposalRow = data as SalesProposalRow | null;
  if (!proposalRow) {
    return null;
  }

  const proposalRowWithSnapshot = await attachStoredSnapshot(proposalRow);

  return {
    proposalRow: proposalRowWithSnapshot,
    proposal: mapSalesProposalRow(proposalRowWithSnapshot),
  };
}

export async function getSalesProposalMutationAccess(slug: string): Promise<SalesProposalAccessResult> {
  const storedProposal = await getSalesProposalBySlug(slug);

  if (!storedProposal) {
    return {
      ok: false,
      status: 404,
      message: "No encontramos la propuesta comercial.",
    };
  }

  if (storedProposal.proposal.workspaceVariant !== "dinterweb") {
    return {
      ok: true,
      proposal: storedProposal.proposal,
      proposalRow: storedProposal.proposalRow,
    };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isAllowedDinterwebUser(user)) {
    return {
      ok: false,
      status: 401,
      message: "Necesitas iniciar sesion con tu correo de Dinterweb.",
    };
  }

  const admin = createSupabaseAdminClient();
  const seller = getDinterwebSellerIdentity(user);
  const proposalSellerEmail = storedProposal.proposal.sellerEmail.trim().toLowerCase();
  const { data: profile } = await admin
    .from("profiles")
    .select("platform_role")
    .eq("id", user.id)
    .maybeSingle();
  const profileRow = profile as PlatformProfileRoleRow | null;
  const canManageAllDinterwebProposals = canManagePlatformUsers(profileRow?.platform_role ?? null);

  if (canManageAllDinterwebProposals) {
    return {
      ok: true,
      proposal: storedProposal.proposal,
      proposalRow: storedProposal.proposalRow,
    };
  }

  if (proposalSellerEmail && proposalSellerEmail !== seller.email) {
    return {
      ok: false,
      status: 403,
      message: "Esta propuesta pertenece a otro vendedor de Dinterweb.",
    };
  }

  return {
    ok: true,
    proposal: storedProposal.proposal,
    proposalRow: storedProposal.proposalRow,
  };
}
