import {
  ACCESS_ROLE_META,
  PLAN_PRICE_FACTOR,
  REDUCTION_PENALTY_RATE,
  RISK_INACTIVE_DAYS,
  TASK_STATUS_META,
} from "@/lib/constants";
import { safeParseNumber, toIsoDate } from "@/lib/utils";
import type { Database, Tables } from "@/types/database";

export type ClientAccessRole = Database["public"]["Enums"]["client_access_role"];
export type ClientProfileRole = Database["public"]["Enums"]["client_profile_role"];
export type InitiativeStatus = Database["public"]["Enums"]["initiative_status"];
export type InitiativeTaskStatus = Database["public"]["Enums"]["initiative_task_status"];
export type CustomPlanType = Database["public"]["Enums"]["custom_plan_type"];
export type CustomPlanBillingMode = Database["public"]["Enums"]["custom_plan_billing_mode"];
export type ProjectStage = Database["public"]["Enums"]["project_stage"];
export type PublicOnboardingAudience = "client" | "prospect";
export type PlanPeriodMonths = 1 | 3 | 6 | 12;

export type ClientSummary = Tables<"clients"> & {
  access_role: ClientAccessRole;
};

export type PublicClientSummary = Pick<
  Tables<"clients">,
  "id" | "slug" | "name" | "description" | "seller_user_id" | "csm_user_id"
>;

export type AssignableUser = {
  id: string;
  email: string;
  full_name: string | null;
};

export type CreditCatalogGroup = Tables<"credit_catalog_groups">;
export type CreditCatalogGroupCategory = Tables<"credit_catalog_group_categories">;
export type CreditCatalogCategory = Tables<"credit_catalog_categories">;
export type CreditCatalogGroupItem = Tables<"credit_catalog_group_items">;
export type CreditCatalogItem = Tables<"credit_catalog_items">;
export type ManagedPrompt = Tables<"managed_prompts">;
export type InitiativeSubItem = Tables<"onboarding_initiative_subitems">;
export type InitiativeLog = Tables<"onboarding_activity_logs"> & {
  author_email?: string | null;
  author_name?: string | null;
};

export type InitiativeRecord = Tables<"onboarding_initiatives"> & {
  subitems: InitiativeSubItem[];
  logs: InitiativeLog[];
  credits: number;
  progressPercent: number;
};

export type OnboardingConfig = Tables<"onboarding_configs">;
export type ShareLinkRecord = Tables<"client_share_links">;
export type ClientMemberRecord = Tables<"client_members"> & {
  email: string | null;
  full_name: string | null;
};

export type ClientBillingStatus = {
  current_cycle_paid: boolean;
  current_cycle_start: string;
  current_cycle_end: string;
  active_credits: number;
  expired_unused_credits: number;
  next_expiration_date: string | null;
  paid_at: string | null;
};

export type OnboardingSnapshot = {
  client: ClientSummary;
  accessRole: ClientAccessRole;
  config: OnboardingConfig;
  billing: ClientBillingStatus;
  initiatives: InitiativeRecord[];
  catalog: CreditCatalogItem[];
  catalogGroups: CreditCatalogGroup[];
  catalogGroupCategories: CreditCatalogGroupCategory[];
  catalogGroupMemberships: CreditCatalogGroupItem[];
  shareLinks: ShareLinkRecord[];
  members: ClientMemberRecord[];
};

export type PublicOnboardingSnapshot = {
  client: PublicClientSummary;
  config: OnboardingConfig;
  billing: ClientBillingStatus;
  initiatives: InitiativeRecord[];
  catalog: CreditCatalogItem[];
  catalogCategories: CreditCatalogCategory[];
  paymentEmail: string | null;
};

export type OnboardingMetrics = {
  total: number;
  available: number;
  reserved: number;
  consumed: number;
  lost: number;
  risk: number;
  cycles: number;
  cutoffDate: string;
  nextExpirationDate: string | null;
};

export type InitiativeEditorDraft = {
  id?: string;
  title: string;
  type: string;
  labels: string[];
  status: InitiativeStatus;
  description: string;
  ownerClient: string;
  ownerCSM: string;
  estStartDate: string;
  estEndDate: string;
  isBlocked: boolean;
  subitems: Array<{
    id?: string;
    catalogItemId: string | null;
    name: string;
    status: InitiativeTaskStatus;
    targetDate: string;
    unitCredits: number;
    quantity: number;
  }>;
  note: string;
};

export function resolveStageFromProfileRole(
  profileRole: ClientProfileRole | null | undefined,
): ProjectStage {
  if (profileRole === "sales") {
    return "sales";
  }

  if (profileRole === "csm") {
    return "cs";
  }

  return "client";
}

export function resolveStageFromPublicAudience(
  audience: PublicOnboardingAudience,
): ProjectStage {
  return audience === "prospect" ? "sales" : "client";
}

export function createDefaultConfig(clientId: string): OnboardingConfig {
  return {
    client_id: clientId,
    start_date: toIsoDate(),
    base_capacity: 80,
    extra_capacity: 0,
    lost_credits: 0,
    custom_plan_credits: null,
    custom_plan_price: null,
    custom_plan_type: null,
    custom_plan_billing_mode: "subscription",
    custom_plan_period_months: 1,
    current_stage: "cs",
    credit_validity_days: 60,
    show_all_completed: false,
    sales_cleared: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    updated_by_user_id: null,
  };
}

export function getExtraCapacityCredits(config: Pick<OnboardingConfig, "extra_capacity">) {
  const extraCapacity = Math.max(0, safeParseNumber(config.extra_capacity));

  // Compatibilidad con registros antiguos donde extra_capacity representaba
  // la cantidad de paquetes legacy de 12 creditos.
  if (extraCapacity > 0 && extraCapacity <= 10) {
    return extraCapacity * 12;
  }

  return extraCapacity;
}

export function createDefaultBillingStatus(config: OnboardingConfig): ClientBillingStatus {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const start = new Date(`${config.start_date}T00:00:00`);
  const anchorDay = start.getDate();
  const cycleStart = new Date(today.getFullYear(), today.getMonth(), anchorDay);

  if (today < cycleStart) {
    cycleStart.setMonth(cycleStart.getMonth() - 1);
  }

  const cycleEnd = new Date(cycleStart);
  cycleEnd.setMonth(cycleEnd.getMonth() + 1);
  cycleEnd.setDate(cycleEnd.getDate() - 1);

  return {
    current_cycle_paid: false,
    current_cycle_start: toIsoDate(cycleStart),
    current_cycle_end: toIsoDate(cycleEnd),
    active_credits: 0,
    expired_unused_credits: 0,
    next_expiration_date: null,
    paid_at: null,
  };
}

export function createEmptyDraft(status: InitiativeStatus = "backlog"): InitiativeEditorDraft {
  return {
    title: "",
    type: "",
    labels: [],
    status,
    description: "",
    ownerClient: "",
    ownerCSM: "",
    estStartDate: "",
    estEndDate: "",
    isBlocked: false,
    subitems: [],
    note: "",
  };
}

export function calculateCredits(
  subitems: Pick<InitiativeSubItem, "unit_credits" | "quantity">[],
) {
  return subitems.reduce(
    (total, item) => total + safeParseNumber(item.unit_credits) * safeParseNumber(item.quantity),
    0,
  );
}

export function calculateInitiativeProgress(
  subitems: Pick<InitiativeSubItem, "quantity" | "status">[],
) {
  if (!subitems.length) {
    return 0;
  }

  const totalWeight = subitems.reduce(
    (sum, subitem) => sum + Math.max(1, safeParseNumber(subitem.quantity)),
    0,
  );

  if (totalWeight <= 0) {
    return 0;
  }

  const completedWeight = subitems.reduce((sum, subitem) => {
    const quantity = Math.max(1, safeParseNumber(subitem.quantity));
    const factor =
      subitem.status === "completed" ? 1 : subitem.status === "in_progress" ? 0.5 : 0;

    return sum + quantity * factor;
  }, 0);

  return Math.max(0, Math.min(100, Math.round((completedWeight / totalWeight) * 100)));
}

export function mapInitiative(
  initiative: Tables<"onboarding_initiatives">,
  subitems: InitiativeSubItem[],
  logs: InitiativeLog[],
): InitiativeRecord {
  const sortedSubitems = [...subitems].sort((left, right) => left.sort_order - right.sort_order);
  const sortedLogs = [...logs].sort((left, right) =>
    left.created_at < right.created_at ? 1 : -1,
  );

  return {
    ...initiative,
    subitems: sortedSubitems,
    logs: sortedLogs,
    credits: calculateCredits(sortedSubitems),
    progressPercent: calculateInitiativeProgress(sortedSubitems),
  };
}

export function calculateMetrics(
  config: OnboardingConfig,
  initiatives: InitiativeRecord[],
  billing?: ClientBillingStatus,
): OnboardingMetrics {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const start = new Date(`${config.start_date}T00:00:00`);
  const startDay = start.getDate();
  const nextCutoff = new Date(today.getFullYear(), today.getMonth(), startDay);

  if (today >= nextCutoff) {
    nextCutoff.setMonth(nextCutoff.getMonth() + 1);
  }

  const purchaseWindowStart = new Date(today);
  purchaseWindowStart.setDate(purchaseWindowStart.getDate() - config.credit_validity_days);

  let cycles = 0;
  let nextExpirationDate: string | null = null;
  if (start <= today) {
    const cursor = new Date(start);
    while (cursor <= today) {
      if (cursor >= purchaseWindowStart) {
        cycles += 1;
        const expiry = new Date(cursor);
        expiry.setDate(expiry.getDate() + config.credit_validity_days);
        if (!nextExpirationDate || expiry < new Date(`${nextExpirationDate}T00:00:00`)) {
          nextExpirationDate = toIsoDate(expiry);
        }
      }
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  if (cycles === 0 && start > today) {
    nextExpirationDate = toIsoDate(start);
  }

  const reserved = initiatives
    .filter((initiative) => initiative.status === "planned" || initiative.status === "executing")
    .reduce((sum, initiative) => sum + initiative.credits, 0);

  const consumed = initiatives
    .filter((initiative) => initiative.status === "completed")
    .reduce((sum, initiative) => sum + initiative.credits, 0);

  const risk = initiatives
    .filter(
      (initiative) =>
        initiative.status === "executing" &&
        daysInactive(initiative.last_activity) > RISK_INACTIVE_DAYS,
    )
    .reduce((sum, initiative) => sum + initiative.credits, 0);

  const planCredits = getMonthlyContractCredits(config);
  const activeCycles = Math.max(cycles, 1);
  const extraCapacityCredits = getExtraCapacityCredits(config);
  const total = billing
    ? billing.active_credits + extraCapacityCredits
    : planCredits * activeCycles + extraCapacityCredits;
  const lost = config.lost_credits + (billing?.expired_unused_credits ?? 0);

  return {
    total,
    available: Math.max(0, total - reserved - consumed - lost),
    reserved,
    consumed,
    lost,
    risk,
    cycles,
    cutoffDate: toIsoDate(nextCutoff),
    nextExpirationDate: billing?.next_expiration_date ?? nextExpirationDate,
  };
}

export function daysInactive(date: string | null) {
  if (!date) {
    return 0;
  }

  const target = new Date(`${date}T00:00:00`);
  const today = new Date();
  return Math.ceil((today.getTime() - target.getTime()) / (1000 * 60 * 60 * 24));
}

export function getEstimatedStatus(
  startDate: string | null,
  endDate: string | null,
  status: InitiativeStatus,
) {
  if (!startDate || !endDate) {
    return null;
  }

  if (status === "completed") {
    return {
      label: "Completado",
      tone: "bg-slate-100 text-slate-700",
    };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);

  const daysUntilStart = Math.ceil((start.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  const daysUntilEnd = Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (daysUntilStart > 0) {
    return {
      label: `Inicia en ${daysUntilStart} d`,
      tone: "bg-slate-100 text-slate-700",
    };
  }

  if (daysUntilEnd >= 0) {
    if (daysUntilEnd <= 1) {
      return {
        label: daysUntilEnd === 0 ? "Vence hoy" : "Vence manana",
        tone: "bg-amber-100 text-amber-800",
      };
    }

    return {
      label: `Faltan ${daysUntilEnd} d`,
      tone: "bg-amber-50 text-amber-700",
    };
  }

  return {
    label: `Atrasado ${Math.abs(daysUntilEnd)} d`,
    tone: "bg-rose-100 text-rose-700",
  };
}

export function formatDateRange(startDate: string | null, endDate: string | null) {
  if (!startDate || !endDate) {
    return "Sin fechas";
  }

  const formatter = new Intl.DateTimeFormat("es-NI", {
    day: "numeric",
    month: "short",
  });

  return `${formatter.format(new Date(`${startDate}T00:00:00`))} al ${formatter.format(new Date(`${endDate}T00:00:00`))}`;
}

export function getRoleLabel(role: ClientAccessRole) {
  return ACCESS_ROLE_META[role].label;
}

export function canEdit(role: ClientAccessRole) {
  return role === "owner" || role === "editor";
}

export function suggestPlanPrice(credits: number) {
  return Math.round(credits * PLAN_PRICE_FACTOR);
}

export function normalizePlanPeriodMonths(value: number | null | undefined): PlanPeriodMonths {
  if (value === 3 || value === 6 || value === 12) {
    return value;
  }

  return 1;
}

export function getPlanPeriodLabel(months: number | null | undefined) {
  const normalized = normalizePlanPeriodMonths(months);

  if (normalized === 3) return "trimestre";
  if (normalized === 6) return "semestre";
  if (normalized === 12) return "año";
  return "mes";
}

export function getPlanCadenceLabel(months: number | null | undefined) {
  const normalized = normalizePlanPeriodMonths(months);

  if (normalized === 3) return "trimestral";
  if (normalized === 6) return "semestral";
  if (normalized === 12) return "anual";
  return "mensual";
}

export function getPlanBillingModeLabel(mode: CustomPlanBillingMode | null | undefined) {
  return mode === "one_time" ? "paquete unico" : "membresia recurrente";
}

export function getTaskStatusLabel(status: InitiativeTaskStatus) {
  return TASK_STATUS_META[status].label;
}

export function splitCreditsAcrossMonths(totalCredits: number, months: number | null | undefined) {
  const normalizedMonths = normalizePlanPeriodMonths(months);
  const safeTotal = Math.max(0, Math.round(totalCredits));
  const base = Math.floor(safeTotal / normalizedMonths);
  const remainder = safeTotal % normalizedMonths;

  return Array.from(
    { length: normalizedMonths },
    (_, index) => base + (index < remainder ? 1 : 0),
  );
}

export function getMonthlyContractCredits(config: Pick<OnboardingConfig, "base_capacity" | "custom_plan_credits" | "custom_plan_period_months">) {
  const contractedCredits = config.custom_plan_credits ?? config.base_capacity;
  return splitCreditsAcrossMonths(contractedCredits, config.custom_plan_period_months)[0] ?? 0;
}

export function calculateReductionPenalty(previousCredits: number, nextCredits: number) {
  if (nextCredits >= previousCredits) {
    return 0;
  }

  return Math.ceil((previousCredits - nextCredits) * REDUCTION_PENALTY_RATE);
}
