import {
  createDefaultBillingStatus,
  type InitiativeRecord,
  type OnboardingConfig,
  type PublicOnboardingSnapshot,
} from "@/lib/onboarding";
import {
  calculateSalesInitiativeCredits,
  calculateSalesInitiativeProgress,
  mapSalesProposalRow,
  type SalesProposalInitiativeDraft,
  type SalesProposalRecord,
} from "@/lib/sales-proposals";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isMissingSupabaseTable } from "@/lib/utils";
import { toIsoDate } from "@/lib/utils";
import type { Database } from "@/types/database";

type SalesProposalRow = Database["public"]["Tables"]["sales_proposals"]["Row"];
type SalesProposalSnapshotRow = Database["public"]["Tables"]["sales_proposal_snapshots"]["Row"];

export type PublicProspectSnapshotBase = Pick<
  PublicOnboardingSnapshot,
  "client" | "config" | "billing" | "initiatives" | "paymentEmail" | "prospectProposal"
>;

function normalizeInitiativeStatus(
  value: string | null | undefined,
): InitiativeRecord["status"] {
  if (value === "planned" || value === "executing" || value === "completed") {
    return value;
  }

  return "backlog";
}

function normalizeSubitemStatus(
  value: string | null | undefined,
): InitiativeRecord["subitems"][number]["status"] {
  if (value === "in_progress" || value === "blocked" || value === "completed") {
    return value;
  }

  return "pending";
}

function createProspectConfig(proposal: SalesProposalRecord): OnboardingConfig {
  const nowIso = new Date().toISOString();

  return {
    client_id: proposal.activatedClientId ?? proposal.id ?? proposal.slug ?? "prospect",
    start_date: proposal.startDate || toIsoDate(),
    base_capacity: proposal.contractedCredits,
    extra_capacity: 0,
    lost_credits: 0,
    custom_plan_credits: proposal.contractedCredits,
    custom_plan_price: proposal.quotedPrice,
    custom_plan_type: proposal.billingMode === "subscription" ? "mensual" : "proyecto",
    custom_plan_billing_mode: proposal.billingMode,
    custom_plan_period_months: proposal.periodMonths,
    current_stage: "sales",
    credit_validity_days: 60,
    show_all_completed: false,
    sales_cleared: false,
    created_at: proposal.createdAt || nowIso,
    updated_at: proposal.updatedAt || nowIso,
    updated_by_user_id: null,
  };
}

export function mapProposalInitiativeToPublicRecord(
  initiative: SalesProposalInitiativeDraft,
  proposal: Pick<
    SalesProposalRecord,
    "id" | "slug" | "createdAt" | "updatedAt" | "startDate"
  >,
  sortOrderFallback = 0,
): InitiativeRecord {
  const nowIso = proposal.updatedAt || new Date().toISOString();
  const datePlanned = proposal.startDate || toIsoDate();
  const status = normalizeInitiativeStatus(initiative.status);
  const subitems = initiative.subitems.map((subitem, index) => ({
    id: subitem.id,
    initiative_id: initiative.id,
    catalog_item_id: subitem.catalogItemId,
    name: subitem.name,
    status: normalizeSubitemStatus(subitem.status),
    target_date: subitem.targetDate || null,
    unit_credits: Number(subitem.unitCredits ?? 0),
    quantity: Number(subitem.quantity ?? 1),
    sort_order: index,
    created_at: proposal.createdAt || nowIso,
    updated_at: nowIso,
  }));

  return {
    id: initiative.id,
    client_id: proposal.id ?? proposal.slug ?? "prospect",
    title: initiative.title,
    type: initiative.type,
    labels: [],
    status,
    description: initiative.description,
    owner_client: null,
    owner_csm: null,
    est_start_date: initiative.estStartDate || null,
    est_end_date: initiative.estEndDate || null,
    date_planned: datePlanned,
    last_activity: datePlanned,
    is_blocked: Boolean(initiative.isBlocked),
    sort_order: Number(initiative.sortOrder ?? sortOrderFallback),
    created_at: proposal.createdAt || nowIso,
    updated_at: nowIso,
    created_by_user_id: null,
    updated_by_user_id: null,
    subitems,
    logs: [],
    credits: calculateSalesInitiativeCredits(initiative),
    progressPercent: calculateSalesInitiativeProgress(initiative),
  };
}

export function buildPublicProspectSnapshotBase(
  proposal: SalesProposalRecord,
): PublicProspectSnapshotBase {
  const config = createProspectConfig(proposal);
  const billing = {
    ...createDefaultBillingStatus(config),
    active_credits: proposal.contractedCredits,
    current_cycle_paid: proposal.status === "paid" || proposal.status === "board_activated",
    paid_at: proposal.paidAt,
  };

  return {
    client: {
      id: proposal.activatedClientId ?? proposal.id ?? proposal.slug ?? "prospect",
      slug: proposal.slug ?? proposal.id ?? "prospect",
      name: proposal.clientCompany || proposal.clientName || "Prospecto",
      description: proposal.clientDescription || proposal.title || "",
      seller_user_id: null,
      csm_user_id: proposal.assignedCsmUserId || null,
    },
    config,
    billing,
    initiatives: proposal.initiatives.map((initiative, index) =>
      mapProposalInitiativeToPublicRecord(initiative, proposal, index),
    ),
    paymentEmail: proposal.sellerEmail || null,
    prospectProposal: {
      workspaceVariant: proposal.workspaceVariant || "hubspot",
      appliedCouponCode: proposal.appliedCouponCode || "",
      appliedCouponType: proposal.appliedCouponType,
      appliedCouponPercentageOff: proposal.appliedCouponPercentageOff,
    },
  };
}

export async function getSalesProposalBySlug(slug: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("sales_proposals")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  const proposalRow = data as SalesProposalRow | null;

  if (error) {
    throw error;
  }

  if (!proposalRow) {
    return null;
  }

  const { data: snapshotData, error: snapshotError } = await admin
    .from("sales_proposal_snapshots")
    .select("snapshot")
    .eq("proposal_id", proposalRow.id)
    .maybeSingle();
  const snapshotRow = snapshotData as Pick<SalesProposalSnapshotRow, "snapshot"> | null;

  if (snapshotError && !isMissingSupabaseTable(snapshotError, "sales_proposal_snapshots")) {
    throw snapshotError;
  }

  return mapSalesProposalRow(
    snapshotRow?.snapshot
      ? ({
          ...proposalRow,
          snapshot: snapshotRow.snapshot,
        } as SalesProposalRow)
      : proposalRow,
  );
}
