import type { SalesProposalRecord } from "@/lib/sales-proposals";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { safeParseNumber } from "@/lib/utils";
import type { Database } from "@/types/database";

type OnboardingConfigRow = Database["public"]["Tables"]["onboarding_configs"]["Row"];
type OnboardingInitiativeRow = Database["public"]["Tables"]["onboarding_initiatives"]["Row"];
type OnboardingInitiativeSubitemRow = Database["public"]["Tables"]["onboarding_initiative_subitems"]["Row"];

function normalizePeriodMonths(
  value: number | null | undefined,
  fallback: SalesProposalRecord["periodMonths"],
): SalesProposalRecord["periodMonths"] {
  return value === 3 || value === 6 || value === 12 ? value : fallback;
}

function buildUpdatedAt(proposal: SalesProposalRecord, timestamps: Array<string | null | undefined>) {
  return timestamps
    .filter((value): value is string => Boolean(value))
    .reduce(
      (latest, current) =>
        new Date(current).getTime() > new Date(latest).getTime() ? current : latest,
      proposal.updatedAt,
    );
}

function getSalesValidationStatusFromLabels(
  labels: string[] | null | undefined,
): SalesProposalRecord["initiatives"][number]["validationStatus"] {
  if (labels?.includes("Validado")) return "validated";
  if (labels?.includes("En revisión")) return "reviewing";
  return null;
}

export async function resolveLiveSalesProposalRecords(proposals: SalesProposalRecord[]) {
  const targetProposals = proposals.filter(
    (proposal) => proposal.status === "board_activated" && Boolean(proposal.activatedClientId),
  );

  if (!targetProposals.length) {
    return proposals;
  }

  const admin = createSupabaseAdminClient();
  const clientIds = targetProposals
    .map((proposal) => proposal.activatedClientId)
    .filter((clientId): clientId is string => Boolean(clientId));

  const { data: configRows, error: configError } = await admin
    .from("onboarding_configs")
    .select("*")
    .in("client_id", clientIds);

  if (configError) {
    throw configError;
  }

  const { data: initiativeRows, error: initiativesError } = await admin
    .from("onboarding_initiatives")
    .select("*")
    .in("client_id", clientIds)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (initiativesError) {
    throw initiativesError;
  }

  const typedInitiatives = (initiativeRows ?? []) as OnboardingInitiativeRow[];
  const initiativeIds = typedInitiatives.map((initiative) => initiative.id);
  let typedSubitems: OnboardingInitiativeSubitemRow[] = [];

  if (initiativeIds.length) {
    const { data: subitemRows, error: subitemsError } = await admin
      .from("onboarding_initiative_subitems")
      .select("*")
      .in("initiative_id", initiativeIds)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (subitemsError) {
      throw subitemsError;
    }

    typedSubitems = (subitemRows ?? []) as OnboardingInitiativeSubitemRow[];
  }

  const configByClientId = new Map(
    ((configRows ?? []) as OnboardingConfigRow[]).map((config) => [config.client_id, config] as const),
  );
  const initiativesByClientId = new Map<string, OnboardingInitiativeRow[]>();
  const subitemsByInitiativeId = new Map<string, OnboardingInitiativeSubitemRow[]>();

  typedInitiatives.forEach((initiative) => {
    const bucket = initiativesByClientId.get(initiative.client_id) ?? [];
    bucket.push(initiative);
    initiativesByClientId.set(initiative.client_id, bucket);
  });

  typedSubitems.forEach((subitem) => {
    const bucket = subitemsByInitiativeId.get(subitem.initiative_id) ?? [];
    bucket.push(subitem);
    subitemsByInitiativeId.set(subitem.initiative_id, bucket);
  });

  return proposals.map((proposal) => {
    if (proposal.status !== "board_activated" || !proposal.activatedClientId) {
      return proposal;
    }

    const config = configByClientId.get(proposal.activatedClientId) ?? null;
    const initiativesForClient = initiativesByClientId.get(proposal.activatedClientId) ?? [];
    const subitemsForClient = typedSubitems.filter((subitem) =>
      initiativesForClient.some((initiative) => initiative.id === subitem.initiative_id),
    );
    const liveInitiatives: SalesProposalRecord["initiatives"] = initiativesForClient.map((initiative) => ({
      id: initiative.id,
      title: initiative.title,
      type: initiative.type ?? "",
      status: initiative.status,
      validationStatus: getSalesValidationStatusFromLabels(initiative.labels),
      description: initiative.description ?? "",
      estStartDate: initiative.est_start_date ?? "",
      estEndDate: initiative.est_end_date ?? "",
      sortOrder: initiative.sort_order,
      isBlocked: initiative.is_blocked,
      subitems: (subitemsByInitiativeId.get(initiative.id) ?? []).map((subitem) => ({
        id: subitem.id,
        catalogItemId: subitem.catalog_item_id,
        name: subitem.name,
        status: subitem.status,
        targetDate: subitem.target_date ?? "",
        unitCredits: Math.max(0, safeParseNumber(subitem.unit_credits)),
        quantity: Math.max(1, safeParseNumber(subitem.quantity)),
      })),
    }));

    return {
      ...proposal,
      startDate: config?.start_date ?? proposal.startDate,
      contractedCredits: Math.max(
        0,
        safeParseNumber(config?.custom_plan_credits ?? config?.base_capacity ?? proposal.contractedCredits),
      ),
      quotedPrice: Math.max(0, safeParseNumber(config?.custom_plan_price ?? proposal.quotedPrice)),
      billingMode: config?.custom_plan_billing_mode ?? proposal.billingMode,
      periodMonths: normalizePeriodMonths(config?.custom_plan_period_months, proposal.periodMonths),
      initiatives: liveInitiatives,
      updatedAt: buildUpdatedAt(proposal, [
        config?.updated_at,
        ...initiativesForClient.map((initiative) => initiative.updated_at),
        ...subitemsForClient.map((subitem) => subitem.updated_at),
      ]),
    } satisfies SalesProposalRecord;
  });
}

export async function resolveLiveSalesProposalRecord(proposal: SalesProposalRecord) {
  const [resolvedProposal] = await resolveLiveSalesProposalRecords([proposal]);
  return resolvedProposal;
}
