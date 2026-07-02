import { redirect } from "next/navigation";

import { ReportsPanel } from "@/components/reports/reports-panel";
import { requireUser } from "@/lib/auth";
import { normalizeInitiativeTitle } from "@/lib/onboarding";
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
};

type InitiativeReportRow = {
  id: string;
  client_id: string;
  title: string;
  type: string | null;
  labels: string[];
  status: "backlog" | "planned" | "executing" | "completed";
  updated_at: string;
  credits: number;
};

type CustomerSuccessConfigRow = {
  client_id: string;
  north_star_text: string | null;
  north_star_status: "pending" | "cs_preapproved" | "client_approved" | "completed";
  north_star_lifecycle_status: "active" | "inactive" | "fulfilled";
};

type CustomerSuccessCreditGrantRow = {
  client_id: string;
  granted_credits: number;
  used_credits: number;
  expired_credits: number;
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

export default async function ReportsPage() {
  const { platformProfile } = await requireUser("/informes");
  const platformRole = platformProfile?.platform_role ?? null;

  if (platformRole !== "admin" && platformRole !== "superadmin") {
    redirect("/dashboard");
  }

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
    .select("id")
    .eq("is_active", true);

  if (activeClientsError) {
    throw new Error("No pudimos cargar los clientes activos para informes.");
  }

  const activeClientIds = ((activeClientRows ?? []) as Array<{ id: string }>).map((client) => client.id);

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
  const customerSuccessProfiles = ((customerSuccessProfileRows ?? []) as CustomerSuccessPlatformProfileRow[]).filter(
    (profile) =>
      profile.platform_role === "csm" ||
      ((profile.platform_role === "admin" || profile.platform_role === "superadmin") &&
        assignedCustomerSuccessIds.has(profile.id)),
  );
  const clientIds = clientRows.map((row) => row.client_id);
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
        .select("id, client_id, title, type, labels, status, updated_at")
        .in("client_id", clientIds)
    : { data: [] as InitiativeReportRow[], error: null };

  const { data: customerSuccessConfigRows, error: customerSuccessConfigError } = clientIds.length
    ? await admin
        .from("onboarding_configs")
        .select("client_id, north_star_text, north_star_status, north_star_lifecycle_status")
        .in("client_id", clientIds)
    : { data: [] as CustomerSuccessConfigRow[], error: null };

  const initiativeIds = (initiativeRows ?? []).map((initiative) => initiative.id);
  const { data: initiativeSubitemRows, error: initiativeSubitemsError } = initiativeIds.length
    ? await admin
        .from("onboarding_initiative_subitems")
        .select("initiative_id, unit_credits, quantity")
        .in("initiative_id", initiativeIds)
    : { data: [] as Array<{ initiative_id: string; unit_credits: number; quantity: number }>, error: null };

  const { data: customerSuccessCreditGrantRows, error: customerSuccessCreditGrantError } = clientIds.length
    ? await admin
        .from("client_credit_grants")
        .select("client_id, granted_credits, used_credits, expired_credits, expires_at")
        .in("client_id", clientIds)
    : { data: [] as CustomerSuccessCreditGrantRow[], error: null };

  if (initiativesError) {
    throw new Error("No pudimos cargar las iniciativas para informes.");
  }

  if (initiativeSubitemsError) {
    throw new Error("No pudimos cargar los créditos de las iniciativas.");
  }

  if (customerSuccessConfigError) {
    throw new Error("No pudimos cargar la capacidad de Customer Success.");
  }

  if (customerSuccessCreditGrantError) {
    throw new Error("No pudimos cargar los créditos vigentes de Customer Success.");
  }

  const northStarCounts = new Map<string, number>();
  const kickoffCompletedDates = new Map<string, string>();
  const firstUseCaseCompletedDates = new Map<string, string>();
  const stagnantStageDays = new Map<string, number>();
  const evaluationCasesCounts = new Map<string, number>();
  const validatedEvaluationCasesCounts = new Map<string, number>();
  const creditsByInitiative = new Map<string, number>();
  (initiativeSubitemRows ?? []).forEach((subitem) => {
    creditsByInitiative.set(
      subitem.initiative_id,
      (creditsByInitiative.get(subitem.initiative_id) ?? 0) + Number(subitem.unit_credits) * Number(subitem.quantity),
    );
  });
  const initiatives = ((initiativeRows ?? []) as Omit<InitiativeReportRow, "credits">[]).map((initiative) => ({
    ...initiative,
    credits: creditsByInitiative.get(initiative.id) ?? 0,
  }));
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
    if (!currentDate || new Date(initiative.updated_at) < new Date(currentDate)) {
      kickoffCompletedDates.set(initiative.client_id, initiative.updated_at);
    }
  });

  completedInitiatives.forEach((initiative) => {
    const isKickoff = isKickoffText(initiative.title) || isKickoffText(initiative.type);

    if (isKickoff) {
      return;
    }

    const currentDate = firstUseCaseCompletedDates.get(initiative.client_id);
    if (!currentDate || new Date(initiative.updated_at) < new Date(currentDate)) {
      firstUseCaseCompletedDates.set(initiative.client_id, initiative.updated_at);
    }
  });

  const rows = clientRows.map((row) => ({
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
  })) satisfies ClientHealthReportRow[];

  return (
    <ReportsPanel
      rows={rows}
      initiatives={initiatives}
      customerSuccessConfigs={(customerSuccessConfigRows ?? []) as CustomerSuccessConfigRow[]}
      customerSuccessCreditGrants={(customerSuccessCreditGrantRows ?? []) as CustomerSuccessCreditGrantRow[]}
      customerSuccessProfiles={customerSuccessProfiles as CustomerSuccessProfileRow[]}
      northStarHistory={(northStarHistoryRows ?? []) as Array<{ id: string; client_id: string; north_star_text: string; north_star_status: "pending" | "cs_preapproved" | "client_approved" | "completed"; north_star_lifecycle_status: "active" | "inactive" | "fulfilled"; created_at: string }>}
      northStarAudits={(northAuditRows ?? []) as Array<Record<string, unknown>>}
    />
  );
}
