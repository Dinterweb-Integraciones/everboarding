import { unstable_cache } from "next/cache";
import { redirect } from "next/navigation";

import { ReportsPanel } from "@/components/reports/reports-panel";
import { requireUser } from "@/lib/auth";
import {
  buildMonthlyGoalProgress,
  getRecentMonthKeys,
  monthKeyToDate,
  redactMonthlyGoalEntry,
  type MonthlyGoalRow,
} from "@/lib/cs-monthly-goals";
import { fetchUserMemberships } from "@/lib/membership-access";
import { getBaseUnitCredits, normalizeInitiativeTitle } from "@/lib/onboarding";
import { REPORTS_CACHE_TAG } from "@/lib/reports-cache";
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
  contracted_credits_period_months: number;
  flow_credits: number | null;
  current_cycle_start_at: string;
  current_cycle_end_at: string | null;
  is_active: boolean;
  observations: string | null;
  cycle_colors: CycleColumnColors | null;
};

type CycleColumnColor = "verde" | "naranja" | "rojo" | "gris";

type CycleColumnColors = {
  available: CycleColumnColor;
  committed: CycleColumnColor;
  evaluation: CycleColumnColor;
};

type CycleColorsRow = {
  client_id: string;
  available_color: CycleColumnColor;
  committed_color: CycleColumnColor;
  evaluation_color: CycleColumnColor;
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
  stage_entered_at: string;
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

type ClientMilestoneRow = {
  id: string;
  created_at: string;
  csm_user_id: string | null;
  is_active: boolean;
  // clients.observations no está en database.ts (ver límite de complejidad de tipos).
  observations: string | null;
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
  assigned_csm_user_id: string | null;
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
  flow_credits: number | null;
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

// PostgREST devuelve como máximo 1000 filas por consulta y descarta el resto sin avisar. Las tablas
// que pueden pasar ese tope se leen por páginas; la consulta debe ordenar por una columna única
// para que ninguna fila se repita ni se pierda entre páginas.
const REPORT_PAGE_SIZE = 1000;

async function fetchAllReportPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
) {
  const rows: T[] = [];

  for (let from = 0; ; from += REPORT_PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + REPORT_PAGE_SIZE - 1);
    if (error) {
      return { data: null, error };
    }

    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < REPORT_PAGE_SIZE) {
      return { data: rows, error: null };
    }
  }
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

// Las consultas del informe se guardan en la caché de datos de Next por unos minutos para no
// repetirlas en cada visita. La caché admite como máximo 2MB por entrada, por eso se guarda en dos
// partes y de las iniciativas solo el resultado ya procesado, sin historial ni snapshots crudos.
// Los datos son los de todos los clientes; lo que depende del usuario se filtra en la página.
const REPORTS_CACHE_REVALIDATE_SECONDS = 300;

async function loadReportBase(goalRangeStart: string, goalRangeEnd: string) {
  const admin = createSupabaseAdminClient();
  const [
    { data: customerSuccessProfileRows, error: customerSuccessProfilesError },
    { data: clientRecords, error: clientsError },
    { data: unassignedPaidProposalRows, error: unassignedPaidProposalsError },
    { data: monthlyGoalRows, error: monthlyGoalsError },
  ] = await Promise.all([
    admin
      .from("profiles")
      .select("id, full_name, email, platform_role")
      .in("platform_role", ["csm", "admin", "superadmin"])
      .order("full_name", { ascending: true }),
    // Se cargan también los clientes inactivos: el informe de Operaciones los sigue
    // mostrando mientras tengan créditos disponibles o comprometidos. El resto de
    // paneles recibe solo clientes activos.
    admin.from("clients").select("id, created_at, csm_user_id, is_active, observations"),
    // Se cargan las de todos los CS; a un Customer Success la página le deja solo las suyas.
    admin
      .from("sales_proposals")
      .select("id, client_name, client_company, paid_at, assigned_csm_user_id")
      .eq("status", "paid")
      .is("activated_client_id", null)
      .not("paid_at", "is", null)
      .order("paid_at", { ascending: true }),
    // customer_success_monthly_goals no está en database.ts (ver límite de complejidad de tipos).
    admin
      .from("customer_success_monthly_goals" as never)
      .select("customer_success_id, month, goal_credits")
      .gte("month", goalRangeStart)
      .lte("month", goalRangeEnd) as unknown as PromiseLike<{
      data: MonthlyGoalRow[] | null;
      error: Error | null;
    }>,
  ]);

  if (customerSuccessProfilesError) {
    throw new Error("No pudimos cargar los perfiles de Customer Success.");
  }

  if (clientsError) {
    throw new Error("No pudimos cargar los clientes para informes.");
  }

  if (unassignedPaidProposalsError) {
    throw new Error("No pudimos cargar los clientes pagados pendientes de asignación.");
  }

  if (monthlyGoalsError) {
    throw new Error("No pudimos cargar las metas mensuales de Customer Success.");
  }

  const allClients = (clientRecords ?? []) as unknown as ClientMilestoneRow[];
  const reportClientIds = allClients.map((client) => client.id);

  // El saldo de los paquetes (used_credits de cada grant) solo se recalcula al ejecutar
  // expire_unused_client_credits, como hace el tablero al abrirse. Sin esto, los casos
  // comprometidos desde la última vez no se descuentan de Disponibles.
  for (let index = 0; index < reportClientIds.length; index += 10) {
    await Promise.all(
      reportClientIds.slice(index, index + 10).map((clientId) =>
        admin.rpc("expire_unused_client_credits" as never, { p_client_id: clientId } as never),
      ),
    );
  }

  const { data, error } = reportClientIds.length
    ? await admin
        .from("client_health_report")
        .select("*")
        .in("client_id", reportClientIds)
        .order("client_name", { ascending: true })
    : { data: [] as Views<"client_health_report">[], error: null };

  if (error) {
    throw new Error("No pudimos cargar el informe de estado de clientes.");
  }

  const clientRows = (data ?? []) as Views<"client_health_report">[];
  const clientIds = clientRows.map((row) => row.client_id);
  const [
    { data: paidBillingCycleRows, error: paidBillingCyclesError },
    { data: activatedProposalRows, error: activatedProposalsError },
    { data: cycleColorRows, error: cycleColorsError },
    { data: northStarHistoryRows, error: northStarHistoryError },
    { data: customerSuccessConfigRows, error: customerSuccessConfigError },
    { data: customerSuccessCreditGrantRows, error: customerSuccessCreditGrantError },
  ] = await Promise.all([
    clientIds.length
      ? admin
          .from("client_billing_cycles")
          .select("client_id, paid_at, cycle_start_date, cycle_end_date")
          .in("client_id", clientIds)
          .eq("status", "paid")
          .not("paid_at", "is", null)
          .order("paid_at", { ascending: true })
      : { data: [] as PaidBillingCycleRow[], error: null },
    clientIds.length
      ? admin
          .from("sales_proposals")
          .select("id, activated_client_id, activated_at")
          .in("activated_client_id", clientIds)
          .not("activated_at", "is", null)
          .order("activated_at", { ascending: true })
      : { data: [] as ActivatedProposalRow[], error: null },
    // Semáforo del ciclo por columna (vista client_cycle_milestones_report). La vista no está en
    // database.ts (ver límite de complejidad de tipos), por eso se lee con un cast.
    clientIds.length
      ? (admin
          .from("client_cycle_milestones_report" as never)
          .select("client_id, available_color, committed_color, evaluation_color")
          .in("client_id", clientIds) as unknown as PromiseLike<{ data: CycleColorsRow[] | null; error: Error | null }>)
      : { data: [] as CycleColorsRow[], error: null },
    clientIds.length
      ? admin
          .from("onboarding_north_star_history")
          .select("id, client_id, north_star_text, north_star_status, north_star_lifecycle_status, created_at")
          .in("client_id", clientIds)
      : { data: [] as Array<{ id: string; client_id: string; north_star_text: string; north_star_status: "pending" | "cs_preapproved" | "client_approved" | "completed"; north_star_lifecycle_status: "active" | "inactive" | "fulfilled"; created_at: string }>, error: null },
    clientIds.length
      ? admin
          .from("onboarding_configs")
          .select("client_id, base_capacity, custom_plan_credits, custom_plan_period_months, flow_credits, north_star_text, north_star_status, north_star_lifecycle_status")
          .in("client_id", clientIds)
      : { data: [] as CustomerSuccessConfigRow[], error: null },
    clientIds.length
      ? admin
          .from("client_credit_grants")
          .select("client_id, granted_credits, used_credits, expired_credits, grant_date, expires_at")
          .in("client_id", clientIds)
      : { data: [] as CustomerSuccessCreditGrantRow[], error: null },
  ]);

  if (paidBillingCyclesError) {
    throw new Error("No pudimos cargar las fechas de pago para el informe operativo.");
  }

  if (activatedProposalsError) {
    throw new Error("No pudimos cargar las fechas de activación para el informe operativo.");
  }

  if (cycleColorsError) {
    throw new Error("No pudimos cargar el semáforo del ciclo.");
  }

  if (northStarHistoryError) {
    throw new Error("No pudimos cargar el conteo de nortes.");
  }

  if (customerSuccessConfigError) {
    throw new Error("No pudimos cargar la capacidad de Customer Success.");
  }

  if (customerSuccessCreditGrantError) {
    throw new Error("No pudimos cargar los créditos vigentes de Customer Success.");
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

  return {
    customerSuccessProfileRows: (customerSuccessProfileRows ?? []) as CustomerSuccessPlatformProfileRow[],
    clientRecords: allClients,
    clientRows,
    unassignedPaidProposalRows: (unassignedPaidProposalRows ?? []) as UnassignedPaidProposalRow[],
    monthlyGoalRows: monthlyGoalRows ?? [],
    paidBillingCycleRows: (paidBillingCycleRows ?? []) as PaidBillingCycleRow[],
    activatedProposalRows: (activatedProposalRows ?? []) as ActivatedProposalRow[],
    cycleColorRows: (cycleColorRows ?? []) as CycleColorsRow[],
    northStarHistoryRows: northStarHistoryRows ?? [],
    northAuditRows: (northAuditRows ?? []) as Array<Record<string, unknown>>,
    customerSuccessConfigRows: (customerSuccessConfigRows ?? []) as CustomerSuccessConfigRow[],
    customerSuccessCreditGrantRows: (customerSuccessCreditGrantRows ?? []) as CustomerSuccessCreditGrantRow[],
    loadedAt: new Date().toISOString(),
  };
}

async function loadReportInitiatives(clientIds: string[], activatedProposalRows: ActivatedProposalRow[]) {
  const admin = createSupabaseAdminClient();
  const activatedProposalIds = activatedProposalRows.map((proposal) => proposal.id);
  const [
    { data: initiativeRows, error: initiativesError },
    { data: catalogGroupRows, error: catalogGroupsError },
    { data: proposalSnapshotRows, error: proposalSnapshotsError },
  ] = await Promise.all([
    clientIds.length
      ? fetchAllReportPages((from, to) =>
          admin
            .from("onboarding_initiatives")
            .select("id, client_id, title, type, labels, status, north_star_history_id, created_at, updated_at")
            .in("client_id", clientIds)
            .order("id", { ascending: true })
            .range(from, to),
        )
      : { data: [] as InitiativeSourceRow[], error: null },
    fetchAllReportPages((from, to) =>
      admin
        .from("credit_catalog_groups")
        .select("name, credits")
        .order("id", { ascending: true })
        .range(from, to),
    ),
    activatedProposalIds.length
      ? admin
          .from("sales_proposal_snapshots")
          .select("proposal_id, snapshot")
          .in("proposal_id", activatedProposalIds)
      : { data: [] as ProposalSnapshotRow[], error: null },
  ]);

  if (initiativesError) {
    throw new Error("No pudimos cargar las iniciativas para informes.");
  }

  if (catalogGroupsError) {
    throw new Error("No pudimos cargar el catálogo de casos de uso.");
  }

  if (proposalSnapshotsError) {
    throw new Error("No pudimos cargar los valores originales de las propuestas.");
  }

  const initiativeIds = (initiativeRows ?? []).map((initiative) => initiative.id);
  const initiativeIdBatches = splitIntoReportBatches(initiativeIds);
  const [initiativeActivityLogResults, initiativeSubitemResults] = await Promise.all([
    Promise.all(
      initiativeIdBatches.map((idBatch) =>
        fetchAllReportPages((from, to) =>
          admin
            .from("onboarding_activity_logs")
            .select("initiative_id, entry, created_at")
            .in("initiative_id", idBatch)
            .order("id", { ascending: true })
            .range(from, to),
        ),
      ),
    ),
    Promise.all(
      initiativeIdBatches.map((idBatch) =>
        fetchAllReportPages((from, to) =>
          admin
            .from("onboarding_initiative_subitems")
            .select("id, initiative_id, catalog_item_id, name, status, target_date, unit_credits, quantity, created_at, updated_at")
            .in("initiative_id", idBatch)
            .order("id", { ascending: true })
            .range(from, to),
        ),
      ),
    ),
  ]);

  if (initiativeActivityLogResults.some((result) => result.error)) {
    throw new Error("No pudimos cargar el historial de estados de las iniciativas.");
  }

  if (initiativeSubitemResults.some((result) => result.error)) {
    throw new Error("No pudimos cargar los créditos de las iniciativas.");
  }

  const initiativeActivityLogRows = initiativeActivityLogResults
    .flatMap((result) => (result.data ?? []) as InitiativeActivityLogRow[])
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
  const initiativeSubitemRows = initiativeSubitemResults.flatMap(
    (result) => (result.data ?? []) as InitiativeSubitemReportRow[],
  );

  const catalogItemIds = [
    ...new Set(initiativeSubitemRows.map((subitem) => subitem.catalog_item_id).filter((id): id is string => Boolean(id))),
  ];
  const catalogItemResults = await Promise.all(
    splitIntoReportBatches(catalogItemIds).map((idBatch) =>
      admin.from("credit_catalog_items").select("id, credits").in("id", idBatch),
    ),
  );

  if (catalogItemResults.some((result) => result.error)) {
    throw new Error("No pudimos cargar el catálogo de créditos.");
  }

  const catalogItemRows = catalogItemResults.flatMap(
    (result) => (result.data ?? []) as Array<{ id: string; credits: number }>,
  );
  const creditsByInitiative = new Map<string, number>();
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
      // Las propuestas de paquetes guardan las tareas con recargo; los informes usan el valor base.
      const getSnapshotBaseCredits = (subitem: (typeof initiative.subitems)[number]) =>
        getBaseUnitCredits(Number(subitem.unitCredits), catalogCreditsById.get(subitem.catalogItemId ?? ""));
      const initiativeCredits = initiative.subitems.reduce(
        (sum, subitem) => sum + getSnapshotBaseCredits(subitem) * Number(subitem.quantity),
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
          Math.max(snapshotUnitCreditsByTask.get(taskKey) ?? 0, getSnapshotBaseCredits(subitem)),
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
      // Informes y metas del CS cuentan el valor base, no el recargo que pagan los clientes de
      // paquetes. Caso de uso sin tareas: una sola subtarea con el precio del grupo.
      return {
        ...subitem,
        unit_credits: getBaseUnitCredits(
          subitem.unit_credits,
          catalogCreditsById.get(subitem.catalog_item_id ?? "") ??
            (!subitem.catalog_item_id && initiative && subitemCountsByInitiative.get(subitem.initiative_id) === 1
              ? catalogGroupCreditsByTitle.get(normalizeInitiativeTitle(initiative.title))
              : undefined),
        ),
      };
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
    // Si el caso se reabrió y se volvió a completar, cuenta la última vez que se completó.
    const completedLog = activityLogs.findLast((log) =>
      normalizeInitiativeTitle(log.entry).includes("cambio a completado"),
    );
    // Última vez que el caso pasó a su etapa actual (Planificado / En ejecución); sin registro
    // del cambio se asume que se creó directamente en esa etapa.
    const currentStageMarker =
      initiative.status === "planned"
        ? "cambio a planificado"
        : initiative.status === "executing"
          ? "cambio a en ejecucion"
          : null;
    const currentStageLog = currentStageMarker
      ? activityLogs.findLast((log) => normalizeInitiativeTitle(log.entry).includes(currentStageMarker))
      : undefined;

    return {
      ...initiative,
      stage_entered_at: currentStageLog?.created_at ?? initiative.created_at,
      executing_at:
        executingLog?.created_at ??
        (initiative.status === "executing" || initiative.status === "completed"
          ? initiative.created_at
          : null),
      // Sin registro del cambio, el caso se creó directamente como completado. No se usa
      // updated_at: cambia con cualquier edición (p. ej. reordenar el tablero) y movería el
      // caso al mes en curso.
      completed_at:
        completedLog?.created_at ??
        (initiative.status === "completed" ? initiative.created_at : null),
      credits: creditsByInitiative.get(initiative.id) ?? 0,
    };
  }) satisfies InitiativeReportRow[];

  return { initiatives, reportSubitems };
}

const getCachedReportBase = unstable_cache(loadReportBase, ["informes-report-base"], {
  tags: [REPORTS_CACHE_TAG],
  revalidate: REPORTS_CACHE_REVALIDATE_SECONDS,
});

const getCachedReportInitiatives = unstable_cache(loadReportInitiatives, ["informes-report-initiatives"], {
  tags: [REPORTS_CACHE_TAG],
  revalidate: REPORTS_CACHE_REVALIDATE_SECONDS,
});

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

  // Progreso contra la meta mensual de cada CS, de los últimos 12 meses. Se calcula en el servidor
  // con todos los clientes; a un Customer Success solo se le envía su propio avance.
  const goalMonths = getRecentMonthKeys(12);
  const reportBase = await getCachedReportBase(
    monthKeyToDate(goalMonths[goalMonths.length - 1]),
    monthKeyToDate(goalMonths[0]),
  );
  const {
    customerSuccessProfileRows,
    clientRecords,
    clientRows,
    monthlyGoalRows,
    paidBillingCycleRows,
    activatedProposalRows,
    cycleColorRows,
    northStarHistoryRows,
    northAuditRows,
    customerSuccessConfigRows,
    customerSuccessCreditGrantRows,
  } = reportBase;
  const unassignedPaidProposalRows = isCsm
    ? reportBase.unassignedPaidProposalRows.filter((proposal) => proposal.assigned_csm_user_id === user.id)
    : reportBase.unassignedPaidProposalRows;
  const { initiatives, reportSubitems } = await getCachedReportInitiatives(
    clientRows.map((row) => row.client_id),
    activatedProposalRows,
  );

  const allClients = (clientRecords ?? []) as unknown as ClientMilestoneRow[];
  // Los datos se calculan sobre todos los clientes para obtener el progreso global de casos de
  // uso; a un Customer Success solo se le envían sus clientes (más ese total ya resumido).
  const reportClients = allClients;
  const visibleClientIds = new Set(
    (isCsm
      ? allClients.filter(
          (client) =>
            client.csm_user_id === user.id ||
            membershipRecords.some(
              (membership) => membership.client_id === client.id && membership.profile_role === "csm",
            ),
        )
      : allClients
    ).map((client) => client.id),
  );
  const activeClientIds = new Set(
    reportClients.filter((client) => client.is_active).map((client) => client.id),
  );
  const clientCreatedAtByClientId = new Map(
    reportClients.map((client) => [client.id, client.created_at]),
  );
  const observationsByClientId = new Map(
    reportClients.map((client) => [client.id, client.observations?.trim() || null]),
  );

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

  const cycleColorsByClientId = new Map<string, CycleColumnColors>(
    (cycleColorRows ?? []).map((row) => [
      row.client_id,
      { available: row.available_color, committed: row.committed_color, evaluation: row.evaluation_color },
    ]),
  );

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
  const todayIsoDate = isoDateDaysAgo(0);
  ((paidBillingCycleRows ?? []) as PaidBillingCycleRow[]).forEach((cycle) => {
    if (!firstPaidDates.has(cycle.client_id)) {
      firstPaidDates.set(cycle.client_id, cycle.paid_at);
    }

    // Un ciclo pagado por adelantado que aún no empieza no es el ciclo actual.
    if (cycle.cycle_start_date > todayIsoDate) return;

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
    if (grant.grant_date > todayIsoDate) return;
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
      contracted_credits_period_months: periodMonths,
      flow_credits: config?.flow_credits ?? null,
      current_cycle_start_at: currentCycleStartAt,
      current_cycle_end_at: latestPaidCycleEnds.get(row.client_id) ?? null,
      is_active: activeClientIds.has(row.client_id),
      observations: observationsByClientId.get(row.client_id) ?? null,
      cycle_colors: cycleColorsByClientId.get(row.client_id) ?? null,
    };
  }) satisfies ClientHealthReportRow[];
  const allCreditGrants = (customerSuccessCreditGrantRows ?? []) as CustomerSuccessCreditGrantRow[];

  const customerSuccessNameById = new Map<string, string>();
  ((customerSuccessProfileRows ?? []) as CustomerSuccessPlatformProfileRow[]).forEach((profile) => {
    customerSuccessNameById.set(profile.id, profile.full_name || profile.email);
  });
  const monthlyGoalProgress = buildMonthlyGoalProgress({
    months: goalMonths,
    goals: monthlyGoalRows ?? [],
    completedInitiatives: initiatives.filter((initiative) => initiative.status === "completed"),
    customerSuccessIdByClientId: new Map(rows.map((row) => [row.client_id, row.customer_success_id])),
    customerSuccessNameById,
  }).map((progress) => {
    if (!isCsm) return progress;
    // Un CS siempre ve su propia barra, aunque ese mes no tenga meta ni avance.
    const ownEntry = progress.customerSuccess.find((entry) => entry.csId === user.id) ?? {
      csId: user.id,
      csName: customerSuccessNameById.get(user.id) ?? "Mi avance",
      completedCredits: 0,
      goalCredits: null,
      percentage: null,
    };
    // El CS no ve el total global. Su barra va primero con créditos y meta; de los demás CS
    // solo se envía el porcentaje de avance.
    return {
      ...progress,
      overall: { completedCredits: ownEntry.completedCredits ?? 0, goalCredits: ownEntry.goalCredits ?? 0 },
      customerSuccess: [
        ownEntry,
        ...progress.customerSuccess
          .filter((entry) => entry.csId !== user.id)
          .map(redactMonthlyGoalEntry),
      ],
    };
  });
  const visibleRows = rows.filter((row) => visibleClientIds.has(row.client_id));
  const visibleInitiatives = initiatives.filter((initiative) => visibleClientIds.has(initiative.client_id));
  const visibleActiveClientIds = new Set(
    [...activeClientIds].filter((clientId) => visibleClientIds.has(clientId)),
  );
  const visibleNorthStarHistoryRows = (northStarHistoryRows ?? []).filter((north) =>
    visibleClientIds.has(north.client_id),
  );
  const visibleNorthHistoryIds = new Set(visibleNorthStarHistoryRows.map((north) => north.id));
  const activeRows = visibleRows.filter((row) => row.is_active);
  const activeInitiatives = visibleInitiatives.filter((initiative) =>
    visibleActiveClientIds.has(initiative.client_id),
  );
  const activeInitiativeIds = new Set(activeInitiatives.map((initiative) => initiative.id));
  const creditGrants = allCreditGrants.filter((grant) => visibleClientIds.has(grant.client_id));

  return (
    <ReportsPanel
      canAuditNorths={!isCsm}
      isCustomerSuccess={isCsm}
      canEditObservations={platformRole === "superadmin"}
      reportsLoadedAt={reportBase.loadedAt}
      rows={activeRows}
      initiatives={activeInitiatives}
      operationsRows={visibleRows}
      operationsInitiatives={visibleInitiatives}
      monthlyGoalProgress={monthlyGoalProgress}
      operationsCreditGrants={creditGrants}
      operationalTasks={reportSubitems.filter((subitem) => activeInitiativeIds.has(subitem.initiative_id))}
      operationalTransitionClients={[
        ...activeRows.map((row) => ({
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
      customerSuccessConfigs={((customerSuccessConfigRows ?? []) as CustomerSuccessConfigRow[]).filter(
        (config) => visibleActiveClientIds.has(config.client_id),
      )}
      customerSuccessCreditGrants={creditGrants.filter((grant) => visibleActiveClientIds.has(grant.client_id))}
      customerSuccessProfiles={customerSuccessProfiles as CustomerSuccessProfileRow[]}
      northStarHistory={(visibleNorthStarHistoryRows as Array<{ id: string; client_id: string; north_star_text: string; north_star_status: "pending" | "cs_preapproved" | "client_approved" | "completed"; north_star_lifecycle_status: "active" | "inactive" | "fulfilled"; created_at: string }>).filter(
        (north) => visibleActiveClientIds.has(north.client_id),
      )}
      northStarAudits={((northAuditRows ?? []) as Array<Record<string, unknown>>).filter((audit) =>
        visibleNorthHistoryIds.has(String(audit.north_star_history_id)),
      )}
    />
  );
}
