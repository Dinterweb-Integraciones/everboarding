import { redirect } from "next/navigation";

import { ReportsPanel } from "@/components/reports/reports-panel";
import { requireUser } from "@/lib/auth";
import { fetchUserMemberships } from "@/lib/membership-access";
import { normalizeInitiativeTitle } from "@/lib/onboarding";
import { normalizeSalesProposalDraft } from "@/lib/sales-proposals";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Views } from "@/types/database";

type ClientHealthReportRow = Views<"client_health_report"> & {
  north_stars_count: number;
  kickoff_completed_at: string | null;
  days_since_kickoff_completed: number | null;
  first_use_case_completed_at: string | null;
  days_to_first_use_case: number | null;
  stagnant_stage_days: number | null;
  evaluation_cases_count: number;
  validated_evaluation_cases_count: number;
  contracted_credits: number;
  current_cycle_start_at: string;
  credit_expiration_at: string | null;
};

type InitiativeSourceRow = {
  id: string;
  client_id: string;
  title: string;
  type: string | null;
  labels: string[];
  status: "backlog" | "planned" | "executing" | "completed";
  north_star_history_id: string | null;
  created_at: string;
  updated_at: string;
};

type InitiativeReportRow = InitiativeSourceRow & {
  executing_at: string | null;
  completed_at: string | null;
  credits: number;
};

type InitiativeSubitemReportRow = {
  id: string;
  initiative_id: string;
  catalog_item_id: string | null;
  name: string;
  status: "pending" | "in_progress" | "blocked" | "completed";
  target_date: string | null;
  unit_credits: number;
  quantity: number;
  created_at: string;
  updated_at: string;
};

type ActiveClientMilestoneRow = {
  id: string;
  created_at: string;
  csm_user_id: string | null;
};

type PaidBillingCycleRow = {
  client_id: string;
  paid_at: string;
  cycle_start_date: string;
  cycle_end_date: string;
};

type UnassignedPaidProposalRow = {
  id: string;
  client_name: string;
  client_company: string | null;
  paid_at: string | null;
};

type ActivatedProposalRow = {
  id: string;
  activated_client_id: string | null;
  activated_at: string | null;
};

type ProposalSnapshotRow = {
  proposal_id: string;
  snapshot: unknown;
};

type InitiativeActivityLogRow = {
  initiative_id: string;
  entry: string;
  created_at: string;
};

type CustomerSuccessConfigRow = {
  client_id: string;
  base_capacity: number;
  custom_plan_credits: number | null;
  custom_plan_period_months: number;
  north_star_text: string | null;
  north_star_status: "pending" | "cs_preapproved" | "client_approved" | "completed";
  north_star_lifecycle_status: "active" | "inactive" | "fulfilled";
};

type CustomerSuccessCreditGrantRow = {
  client_id: string;
  granted_credits: number;
  used_credits: number;
  expired_credits: number;
  grant_date: string;
  expires_at: string;
};

type CustomerSuccessProfileRow = {
  id: string;
  full_name: string | null;
  email: string;
};
type CustomerSuccessPlatformProfileRow = CustomerSuccessProfileRow & {
  platform_role: "superadmin" | "admin" | "sales" | "csm" | "finance" | null;
};

const REPORT_QUERY_BATCH_SIZE = 100;

function splitIntoReportBatches<T>(values: T[]) {
  const batches: T[][] = [];

  for (let index = 0; index < values.length; index += REPORT_QUERY_BATCH_SIZE) {
    batches.push(values.slice(index, index + REPORT_QUERY_BATCH_SIZE));
  }

  return batches;
}

function getElapsedCalendarDays(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const targetStart = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());

  return Math.max(
    0,
    Math.floor((todayStart.getTime() - targetStart.getTime()) / (1000 * 60 * 60 * 24)),
  );
}

function getCalendarDayDiff(startValue: string | null, endValue: string | null) {
  if (!startValue || !endValue) {
    return null;
  }

  const start = new Date(startValue);
  const end = new Date(endValue);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }

  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());

  return Math.max(
    0,
    Math.floor((endDay.getTime() - startDay.getTime()) / (1000 * 60 * 60 * 24)),
  );
}

function isKickoffText(value: string | null | undefined) {
  const normalized = normalizeInitiativeTitle(value);
  const compact = normalized.replace(/[^a-z0-9]/g, "");

  return compact.includes("kickoff") || normalized.includes("kick off");
}

function hasValidatedLabel(labels: string[] | null | undefined) {
  return (labels ?? []).some((label) => normalizeInitiativeTitle(label) === "validado");
}

function isCommerciallyWaivedLabel(labels: string[] | null | undefined) {
  return (labels ?? []).some((label) => {
    const normalized = normalizeInitiativeTitle(label);
    return normalized === "bonificado comercialmente" || normalized === "obsequiado comercialmente";
  });
}

function isoDateDaysAgo(days: number) {
  const now = new Date();
  const utcToday = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  utcToday.setUTCDate(utcToday.getUTCDate() - days);
  return utcToday.toISOString().slice(0, 10);
}

function getInitiativeCreditKey(clientId: string, initiativeTitle: string) {
  return `${clientId}:${normalizeInitiativeTitle(initiativeTitle)}`;
}

function getInitiativeTaskCreditKey(clientId: string, initiativeTitle: string, taskName: string) {
  return `${getInitiativeCreditKey(clientId, initiativeTitle)}:${normalizeInitiativeTitle(taskName)}`;
}

export default async function ReportsPage() {
  const { supabase, user, platformProfile } = await requireUser("/informes");
  const platformRole = platformProfile?.platform_role ?? null;
  const isCsm = platformRole === "csm";

  if (platformRole !== "admin" && platformRole !== "superadmin" && !isCsm) {
    redirect("/dashboard");
  }

  const { data: membershipRows, error: membershipError } = isCsm
    ? await fetchUserMemberships(supabase, user.id)
    : { data: [], error: null };

  if (membershipError) {
    console.error("informes_memberships_load_failed", membershipError);
  }

  const membershipRecords = ((membershipError ? [] : membershipRows) ?? []) as Array<{
    client_id: string;
    access_role: "viewer" | "editor" | "owner";
    profile_role: "sales" | "csm" | "client" | "stakeholder";
  }>;

  const admin = createSupabaseAdminClient();
  const { data: customerSuccessProfileRows, error: customerSuccessProfilesError } = await admin
    .from("profiles")
    .select("id, full_name, email, platform_role")
    .in("platform_role", ["csm", "admin", "superadmin"])
    .order("full_name", { ascending: true });

  if (customerSuccessProfilesError) {
    throw new Error("No pudimos cargar los perfiles de Customer Success.");
  }

  const { data: activeClientRows, error: activeClientsError } = await admin
    .from("clients")
    .select("id, created_at, csm_user_id")
    .eq("is_active", true);

  if (activeClientsError) {
    throw new Error("No pudimos cargar los clientes activos para informes.");
  }

  const allActiveClients = (activeClientRows ?? []) as ActiveClientMilestoneRow[];
  const activeClients = isCsm
    ? allActiveClients.filter(
        (client) =>
          client.csm_user_id === user.id ||
          membershipRecords.some(
            (membership) => membership.client_id === client.id && membership.profile_role === "csm",
          ),
      )
    : allActiveClients;
  const activeClientIds = activeClients.map((client) => client.id);
  const clientCreatedAtByClientId = new Map(
    activeClients.map((client) => [client.id, client.created_at]),
  );

  const { data, error } = activeClientIds.length
    ? await admin
        .from("client_health_report")
        .select("*")
        .in("client_id", activeClientIds)
        .order("client_name", { ascending: true })
    : { data: [] as Views<"client_health_report">[], error: null };

  if (error) {
    throw new Error("No pudimos cargar el informe de estado de clientes.");
  }

  const clientRows = (data ?? []) as Views<"client_health_report">[];
  const assignedCustomerSuccessIds = new Set(
    clientRows.flatMap((row) => (row.customer_success_id ? [row.customer_success_id] : [])),
  );
  const customerSuccessProfiles = isCsm
    ? ((customerSuccessProfileRows ?? []) as CustomerSuccessPlatformProfileRow[]).filter(
        (profile) => profile.id === user.id,
      )
    : ((customerSuccessProfileRows ?? []) as CustomerSuccessPlatformProfileRow[]).filter(
        (profile) =>
          profile.platform_role === "csm" ||
          ((profile.platform_role === "admin" || profile.platform_role === "superadmin") &&
            assignedCustomerSuccessIds.has(profile.id)),
      );
  const clientIds = clientRows.map((row) => row.client_id);
  const { data: paidBillingCycleRows, error: paidBillingCyclesError } = clientIds.length
    ? await admin
        .from("client_billing_cycles")
        .select("client_id, paid_at, cycle_start_date, cycle_end_date")
        .in("client_id", clientIds)
        .eq("status", "paid")
        .not("paid_at", "is", null)
        .order("paid_at", { ascending: true })
    : { data: [] as PaidBillingCycleRow[], error: null };

  if (paidBillingCyclesError) {
    throw new Error("No pudimos cargar las fechas de pago para el informe operativo.");
  }

  const { data: activatedProposalRows, error: activatedProposalsError } = clientIds.length
    ? await admin
        .from("sales_proposals")
        .select("id, activated_client_id, activated_at")
        .in("activated_client_id", clientIds)
        .not("activated_at", "is", null)
        .order("activated_at", { ascending: true })
    : { data: [] as ActivatedProposalRow[], error: null };

  if (activatedProposalsError) {
    throw new Error("No pudimos cargar las fechas de activación para el informe operativo.");
  }

  const activatedProposalIds = (activatedProposalRows ?? []).map((proposal) => proposal.id);
  const { data: proposalSnapshotRows, error: proposalSnapshotsError } = activatedProposalIds.length
    ? await admin
        .from("sales_proposal_snapshots")
        .select("proposal_id, snapshot")
        .in("proposal_id", activatedProposalIds)
    : { data: [] as ProposalSnapshotRow[], error: null };

  if (proposalSnapshotsError) {
    throw new Error("No pudimos cargar los valores originales de las propuestas.");
  }

  let unassignedPaidProposalsQuery = admin
    .from("sales_proposals")
    .select("id, client_name, client_company, paid_at")
    .eq("status", "paid")
    .is("activated_client_id", null)
    .not("paid_at", "is", null);

  if (isCsm) {
    unassignedPaidProposalsQuery = unassignedPaidProposalsQuery.eq("assigned_csm_user_id", user.id);
  }

  const { data: unassignedPaidProposalRows, error: unassignedPaidProposalsError } = await unassignedPaidProposalsQuery.order(
    "paid_at",
    { ascending: true },
  );

  if (unassignedPaidProposalsError) {
    throw new Error("No pudimos cargar los clientes pagados pendientes de asignación.");
  }

  const { data: northStarHistoryRows, error: northStarHistoryError } = clientIds.length
    ? await admin
        .from("onboarding_north_star_history")
        .select("id, client_id, north_star_text, north_star_status, north_star_lifecycle_status, created_at")
        .in("client_id", clientIds)
    : { data: [] as Array<{ id: string; client_id: string; north_star_text: string; north_star_status: "pending" | "cs_preapproved" | "client_approved" | "completed"; north_star_lifecycle_status: "active" | "inactive" | "fulfilled"; created_at: string }>, error: null };

  if (northStarHistoryError) {
    throw new Error("No pudimos cargar el conteo de nortes.");
  }

  const northHistoryIds = (northStarHistoryRows ?? []).map((row) => row.id);
  const { data: northAuditRows, error: northAuditsError } = northHistoryIds.length
    ? await admin
        .from("north_star_audits" as never)
        .select("*")
        .in("north_star_history_id", northHistoryIds)
    : { data: [], error: null };

  if (northAuditsError) {
    throw new Error("No pudimos cargar la auditoría de Nortes.");
  }

  const { data: initiativeRows, error: initiativesError } = clientIds.length
    ? await admin
        .from("onboarding_initiatives")
        .select("id, client_id, title, type, labels, status, north_star_history_id, created_at, updated_at")
        .in("client_id", clientIds)
    : { data: [] as InitiativeSourceRow[], error: null };

  const { data: catalogGroupRows, error: catalogGroupsError } = await admin
    .from("credit_catalog_groups")
    .select("name, credits");

  const { data: customerSuccessConfigRows, error: customerSuccessConfigError } = clientIds.length
    ? await admin
        .from("onboarding_configs")
        .select("client_id, base_capacity, custom_plan_credits, custom_plan_period_months, north_star_text, north_star_status, north_star_lifecycle_status")
        .in("client_id", clientIds)
    : { data: [] as CustomerSuccessConfigRow[], error: null };

  const initiativeIds = (initiativeRows ?? []).map((initiative) => initiative.id);
  const initiativeIdBatches = splitIntoReportBatches(initiativeIds);
  const initiativeActivityLogResults = await Promise.all(
    initiativeIdBatches.map((idBatch) =>
      admin
        .from("onboarding_activity_logs")
        .select("initiative_id, entry, created_at")
        .in("initiative_id", idBatch)
        .order("created_at", { ascending: true }),
    ),
  );
  const initiativeActivityLogsError =
    initiativeActivityLogResults.find((result) => result.error)?.error ?? null;
  const initiativeActivityLogRows = initiativeActivityLogResults
    .flatMap((result) => (result.data ?? []) as InitiativeActivityLogRow[])
    .sort((left, right) => left.created_at.localeCompare(right.created_at));

  const initiativeSubitemResults = await Promise.all(
    initiativeIdBatches.map((idBatch) =>
      admin
        .from("onboarding_initiative_subitems")
        .select("id, initiative_id, catalog_item_id, name, status, target_date, unit_credits, quantity, created_at, updated_at")
        .in("initiative_id", idBatch),
    ),
  );
  const initiativeSubitemsError =
    initiativeSubitemResults.find((result) => result.error)?.error ?? null;
  const initiativeSubitemRows = initiativeSubitemResults.flatMap(
    (result) => (result.data ?? []) as InitiativeSubitemReportRow[],
  );

  const catalogItemIds = [
    ...new Set((initiativeSubitemRows ?? []).map((subitem) => subitem.catalog_item_id).filter((id): id is string => Boolean(id))),
  ];
  const catalogItemResults = await Promise.all(
    splitIntoReportBatches(catalogItemIds).map((idBatch) =>
      admin.from("credit_catalog_items").select("id, credits").in("id", idBatch),
    ),
  );
  const catalogItemsError = catalogItemResults.find((result) => result.error)?.error ?? null;
  const catalogItemRows = catalogItemResults.flatMap(
    (result) => (result.data ?? []) as Array<{ id: string; credits: number }>,
  );

  const { data: customerSuccessCreditGrantRows, error: customerSuccessCreditGrantError } = clientIds.length
    ? await admin
        .from("client_credit_grants")
        .select("client_id, granted_credits, used_credits, expired_credits, grant_date, expires_at")
        .in("client_id", clientIds)
    : { data: [] as CustomerSuccessCreditGrantRow[], error: null };

  if (initiativesError) {
    throw new Error("No pudimos cargar las iniciativas para informes.");
  }

  if (initiativeSubitemsError) {
    throw new Error("No pudimos cargar los créditos de las iniciativas.");
  }

  if (catalogItemsError) {
    throw new Error("No pudimos cargar el catálogo de créditos.");
  }

  if (catalogGroupsError) {
    throw new Error("No pudimos cargar el catálogo de casos de uso.");
  }

  if (initiativeActivityLogsError) {
    throw new Error("No pudimos cargar el historial de estados de las iniciativas.");
  }

  if (customerSuccessConfigError) {
    throw new Error("No pudimos cargar la capacidad de Customer Success.");
  }

  if (customerSuccessCreditGrantError) {
    throw new Error("No pudimos cargar los créditos vigentes de Customer Success.");
  }

  const northStarCounts = new Map<string, number>();
  const firstPaidDates = new Map<string, string>();
  const latestPaidCycleStarts = new Map<string, string>();
  const latestPaidCycleEnds = new Map<string, string>();
  const assignedDates = new Map<string, string>();
  const kickoffCompletedDates = new Map<string, string>();
  const firstUseCaseCompletedDates = new Map<string, string>();
  const stagnantStageDays = new Map<string, number>();
  const evaluationCasesCounts = new Map<string, number>();
  const validatedEvaluationCasesCounts = new Map<string, number>();
  const creditsByInitiative = new Map<string, number>();
  ((paidBillingCycleRows ?? []) as PaidBillingCycleRow[]).forEach((cycle) => {
    if (!firstPaidDates.has(cycle.client_id)) {
      firstPaidDates.set(cycle.client_id, cycle.paid_at);
    }

    const currentCycleEnd = latestPaidCycleEnds.get(cycle.client_id);
    if (!currentCycleEnd || cycle.cycle_end_date > currentCycleEnd) {
      latestPaidCycleStarts.set(cycle.client_id, cycle.cycle_start_date);
      latestPaidCycleEnds.set(cycle.client_id, cycle.cycle_end_date);
    }
  });
  ((activatedProposalRows ?? []) as ActivatedProposalRow[]).forEach((proposal) => {
    if (
      proposal.activated_client_id &&
      proposal.activated_at &&
      !assignedDates.has(proposal.activated_client_id)
    ) {
      assignedDates.set(proposal.activated_client_id, proposal.activated_at);
    }
  });

  const activityLogsByInitiativeId = new Map<string, InitiativeActivityLogRow[]>();
  ((initiativeActivityLogRows ?? []) as InitiativeActivityLogRow[]).forEach((log) => {
    const currentLogs = activityLogsByInitiativeId.get(log.initiative_id) ?? [];
    currentLogs.push(log);
    activityLogsByInitiativeId.set(log.initiative_id, currentLogs);
  });
  const catalogCreditsById = new Map(
    ((catalogItemRows ?? []) as Array<{ id: string; credits: number }>).map((item) => [item.id, item.credits]),
  );
  const catalogGroupCreditsByTitle = new Map(
    ((catalogGroupRows ?? []) as Array<{ name: string; credits: number }>).map((group) => [
      normalizeInitiativeTitle(group.name),
      Number(group.credits),
    ]),
  );
  const initiativeById = new Map(
    ((initiativeRows ?? []) as InitiativeSourceRow[]).map((initiative) => [initiative.id, initiative]),
  );
  const activatedClientIdByProposalId = new Map(
    ((activatedProposalRows ?? []) as ActivatedProposalRow[]).flatMap((proposal) =>
      proposal.activated_client_id ? [[proposal.id, proposal.activated_client_id] as const] : [],
    ),
  );
  const snapshotCreditsByInitiative = new Map<string, number>();
  const snapshotUnitCreditsByTask = new Map<string, number>();
  ((proposalSnapshotRows ?? []) as ProposalSnapshotRow[]).forEach((row) => {
    const clientId = activatedClientIdByProposalId.get(row.proposal_id);
    if (!clientId) return;

    const proposal = normalizeSalesProposalDraft(row.snapshot as never);
    proposal.initiatives.forEach((initiative) => {
      const initiativeKey = getInitiativeCreditKey(clientId, initiative.title);
      const initiativeCredits = initiative.subitems.reduce(
        (sum, subitem) => sum + Number(subitem.unitCredits) * Number(subitem.quantity),
        0,
      );
      snapshotCreditsByInitiative.set(
        initiativeKey,
        Math.max(snapshotCreditsByInitiative.get(initiativeKey) ?? 0, initiativeCredits),
      );
      initiative.subitems.forEach((subitem) => {
        const taskKey = getInitiativeTaskCreditKey(clientId, initiative.title, subitem.name);
        snapshotUnitCreditsByTask.set(
          taskKey,
          Math.max(snapshotUnitCreditsByTask.get(taskKey) ?? 0, Number(subitem.unitCredits)),
        );
      });
    });
  });
  const commerciallyWaivedInitiativeIds = new Set(
    ((initiativeRows ?? []) as InitiativeSourceRow[])
      .filter((initiative) => isCommerciallyWaivedLabel(initiative.labels))
      .map((initiative) => initiative.id),
  );
  const subitemCountsByInitiative = new Map<string, number>();
  ((initiativeSubitemRows ?? []) as InitiativeSubitemReportRow[]).forEach((subitem) => {
    subitemCountsByInitiative.set(
      subitem.initiative_id,
      (subitemCountsByInitiative.get(subitem.initiative_id) ?? 0) + 1,
    );
  });
  const reportSubitems = ((initiativeSubitemRows ?? []) as InitiativeSubitemReportRow[]).map((subitem) => {
    const initiative = initiativeById.get(subitem.initiative_id);
    if (!initiative || !commerciallyWaivedInitiativeIds.has(subitem.initiative_id)) {
      return subitem;
    }

    const historicalTaskCredits = snapshotUnitCreditsByTask.get(
      getInitiativeTaskCreditKey(initiative.client_id, initiative.title, subitem.name),
    );
    const catalogGroupCredits = catalogGroupCreditsByTitle.get(normalizeInitiativeTitle(initiative.title));

    return {
      ...subitem,
      // El 0 financiero permanece intacto. Informes usa primero el valor histórico
      // de la propuesta y luego el catálogo actual como respaldo operativo.
      unit_credits:
        historicalTaskCredits
        ?? catalogCreditsById.get(subitem.catalog_item_id ?? "")
        ?? (subitemCountsByInitiative.get(subitem.initiative_id) === 1 ? catalogGroupCredits : undefined)
        ?? subitem.unit_credits,
    };
  });
  reportSubitems.forEach((subitem) => {
    creditsByInitiative.set(
      subitem.initiative_id,
      (creditsByInitiative.get(subitem.initiative_id) ?? 0) + Number(subitem.unit_credits) * Number(subitem.quantity),
    );
  });
  commerciallyWaivedInitiativeIds.forEach((initiativeId) => {
    if ((creditsByInitiative.get(initiativeId) ?? 0) > 0) return;

    const initiative = initiativeById.get(initiativeId);
    if (!initiative) return;

    const initiativeKey = getInitiativeCreditKey(initiative.client_id, initiative.title);
    creditsByInitiative.set(
      initiativeId,
      snapshotCreditsByInitiative.get(initiativeKey)
      ?? catalogGroupCreditsByTitle.get(normalizeInitiativeTitle(initiative.title))
      ?? 0,
    );
  });
  const initiatives = ((initiativeRows ?? []) as InitiativeSourceRow[]).map((initiative) => {
    const activityLogs = activityLogsByInitiativeId.get(initiative.id) ?? [];
    const executingLog = activityLogs.find((log) =>
      normalizeInitiativeTitle(log.entry).includes("cambio a en ejecucion"),
    );
    const completedLog = activityLogs.find((log) =>
      normalizeInitiativeTitle(log.entry).includes("cambio a completado"),
    );

    return {
      ...initiative,
      executing_at:
        executingLog?.created_at ??
        (initiative.status === "executing" || initiative.status === "completed"
          ? initiative.created_at
          : null),
      completed_at:
        completedLog?.created_at ??
        (initiative.status === "completed" ? initiative.updated_at : null),
      credits: creditsByInitiative.get(initiative.id) ?? 0,
    };
  }) satisfies InitiativeReportRow[];
  const completedInitiatives = initiatives.filter((initiative) => initiative.status === "completed");

  (northStarHistoryRows ?? []).forEach((row) => {
    northStarCounts.set(row.client_id, (northStarCounts.get(row.client_id) ?? 0) + 1);
  });

  initiatives.forEach((initiative) => {
    if (initiative.status === "backlog") {
      evaluationCasesCounts.set(
        initiative.client_id,
        (evaluationCasesCounts.get(initiative.client_id) ?? 0) + 1,
      );

      if (hasValidatedLabel(initiative.labels)) {
        validatedEvaluationCasesCounts.set(
          initiative.client_id,
          (validatedEvaluationCasesCounts.get(initiative.client_id) ?? 0) + 1,
        );
      }
    }

    if (initiative.status !== "completed") {
      const daysInStage = getElapsedCalendarDays(initiative.updated_at);
      const currentDays = stagnantStageDays.get(initiative.client_id);

      if (daysInStage !== null && (currentDays === undefined || daysInStage > currentDays)) {
        stagnantStageDays.set(initiative.client_id, daysInStage);
      }
    }
  });

  completedInitiatives.forEach((initiative) => {
    const isKickoff = isKickoffText(initiative.title) || isKickoffText(initiative.type);

    if (!isKickoff) {
      return;
    }

    const currentDate = kickoffCompletedDates.get(initiative.client_id);
    if (
      initiative.completed_at &&
      (!currentDate || new Date(initiative.completed_at) < new Date(currentDate))
    ) {
      kickoffCompletedDates.set(initiative.client_id, initiative.completed_at);
    }
  });

  completedInitiatives.forEach((initiative) => {
    const isKickoff = isKickoffText(initiative.title) || isKickoffText(initiative.type);

    if (isKickoff) {
      return;
    }

    const currentDate = firstUseCaseCompletedDates.get(initiative.client_id);
    if (
      initiative.completed_at &&
      (!currentDate || new Date(initiative.completed_at) < new Date(currentDate))
    ) {
      firstUseCaseCompletedDates.set(initiative.client_id, initiative.completed_at);
    }
  });

  const configByClientId = new Map(
    ((customerSuccessConfigRows ?? []) as CustomerSuccessConfigRow[]).map((config) => [
      config.client_id,
      config,
    ]),
  );
  const latestGrantByClient = new Map<string, CustomerSuccessCreditGrantRow>();
  ((customerSuccessCreditGrantRows ?? []) as CustomerSuccessCreditGrantRow[]).forEach((grant) => {
    const currentLatest = latestGrantByClient.get(grant.client_id);
    if (!currentLatest || grant.grant_date > currentLatest.grant_date) {
      latestGrantByClient.set(grant.client_id, grant);
    }
  });
  const rows = clientRows.map((row) => {
    const config = configByClientId.get(row.client_id);
    const periodMonths = config?.custom_plan_period_months ?? 1;
    const contractedCredits =
      config?.custom_plan_credits ?? (config?.base_capacity ?? 0) * periodMonths;
    const latestGrant = latestGrantByClient.get(row.client_id);
    const currentCycleStartAt =
      latestPaidCycleStarts.get(row.client_id) ?? latestGrant?.grant_date ?? isoDateDaysAgo(30);
    const creditExpirationAt = row.billing === "paquetes" ? latestGrant?.expires_at ?? null : null;

    return {
      ...row,
      north_stars_count: northStarCounts.get(row.client_id) ?? row.north_stars_completed,
      kickoff_completed_at: kickoffCompletedDates.get(row.client_id) ?? null,
      days_since_kickoff_completed: getElapsedCalendarDays(kickoffCompletedDates.get(row.client_id) ?? null),
      first_use_case_completed_at: firstUseCaseCompletedDates.get(row.client_id) ?? null,
      days_to_first_use_case: getCalendarDayDiff(
        kickoffCompletedDates.get(row.client_id) ?? null,
        firstUseCaseCompletedDates.get(row.client_id) ?? null,
      ),
      stagnant_stage_days: stagnantStageDays.get(row.client_id) ?? null,
      evaluation_cases_count: evaluationCasesCounts.get(row.client_id) ?? 0,
      validated_evaluation_cases_count: validatedEvaluationCasesCounts.get(row.client_id) ?? 0,
      contracted_credits: contractedCredits,
      current_cycle_start_at: currentCycleStartAt,
      credit_expiration_at: creditExpirationAt,
    };
  }) satisfies ClientHealthReportRow[];

  return (
    <ReportsPanel
      canAuditNorths={!isCsm}
      rows={rows}
      initiatives={initiatives}
      operationalTasks={reportSubitems}
      operationalTransitionClients={[
        ...rows.map((row) => ({
          id: row.client_id,
          client_id: row.client_id,
          client_name: row.client_name,
          customer_success_id: row.customer_success_id,
          customer_success_name: row.customer_success_name,
          paid_at: firstPaidDates.get(row.client_id) ?? null,
          assigned_at:
            assignedDates.get(row.client_id) ??
            (row.customer_success_id ? clientCreatedAtByClientId.get(row.client_id) ?? null : null),
        })),
        ...((unassignedPaidProposalRows ?? []) as UnassignedPaidProposalRow[])
          .filter((proposal): proposal is UnassignedPaidProposalRow & { paid_at: string } => Boolean(proposal.paid_at))
          .map((proposal) => ({
            id: `proposal-${proposal.id}`,
            client_id: null,
            client_name: proposal.client_company || proposal.client_name,
            customer_success_id: null,
            customer_success_name: null,
            paid_at: proposal.paid_at,
            assigned_at: null,
          })),
      ]}
      customerSuccessConfigs={(customerSuccessConfigRows ?? []) as CustomerSuccessConfigRow[]}
      customerSuccessCreditGrants={(customerSuccessCreditGrantRows ?? []) as CustomerSuccessCreditGrantRow[]}
      customerSuccessProfiles={customerSuccessProfiles as CustomerSuccessProfileRow[]}
      northStarHistory={(northStarHistoryRows ?? []) as Array<{ id: string; client_id: string; north_star_text: string; north_star_status: "pending" | "cs_preapproved" | "client_approved" | "completed"; north_star_lifecycle_status: "active" | "inactive" | "fulfilled"; created_at: string }>}
      northStarAudits={(northAuditRows ?? []) as Array<Record<string, unknown>>}
    />
  );
}
