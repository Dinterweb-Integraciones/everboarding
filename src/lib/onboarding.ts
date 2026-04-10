import {
  ACCESS_ROLE_META,
  PLAN_PRICE_FACTOR,
  REDUCTION_PENALTY_RATE,
  RISK_INACTIVE_DAYS,
} from "@/lib/constants";
import { safeParseNumber, toIsoDate } from "@/lib/utils";
import type { Database, Tables } from "@/types/database";

export type ClientAccessRole = Database["public"]["Enums"]["client_access_role"];
export type ClientProfileRole = Database["public"]["Enums"]["client_profile_role"];
export type InitiativeStatus = Database["public"]["Enums"]["initiative_status"];
export type CustomPlanType = Database["public"]["Enums"]["custom_plan_type"];
export type ProjectStage = Database["public"]["Enums"]["project_stage"];
export type PublicOnboardingAudience = "client" | "prospect";

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

export type CreditCatalogItem = Tables<"credit_catalog_items">;
export type InitiativeSubItem = Tables<"onboarding_initiative_subitems">;
export type InitiativeLog = Tables<"onboarding_activity_logs"> & {
  author_email?: string | null;
  author_name?: string | null;
};

export type InitiativeRecord = Tables<"onboarding_initiatives"> & {
  subitems: InitiativeSubItem[];
  logs: InitiativeLog[];
  credits: number;
};

export type OnboardingConfig = Tables<"onboarding_configs">;
export type ShareLinkRecord = Tables<"client_share_links">;
export type ClientMemberRecord = Tables<"client_members"> & {
  email: string | null;
  full_name: string | null;
};

export type OnboardingSnapshot = {
  client: ClientSummary;
  accessRole: ClientAccessRole;
  config: OnboardingConfig;
  initiatives: InitiativeRecord[];
  catalog: CreditCatalogItem[];
  shareLinks: ShareLinkRecord[];
  members: ClientMemberRecord[];
};

export type PublicOnboardingSnapshot = {
  client: PublicClientSummary;
  config: OnboardingConfig;
  initiatives: InitiativeRecord[];
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
    current_stage: "cs",
    credit_validity_days: 60,
    show_all_completed: false,
    sales_cleared: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    updated_by_user_id: null,
  };
}

export function createEmptyDraft(status: InitiativeStatus = "backlog"): InitiativeEditorDraft {
  return {
    title: "",
    type: "",
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
  };
}

export function calculateMetrics(
  config: OnboardingConfig,
  initiatives: InitiativeRecord[],
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

  const planCredits = config.custom_plan_credits ?? config.base_capacity;
  const activeCycles = Math.max(cycles, 1);
  const total = planCredits * activeCycles + config.extra_capacity * 12;
  const lost = config.lost_credits;

  return {
    total,
    available: total - reserved - consumed - lost,
    reserved,
    consumed,
    lost,
    risk,
    cycles,
    cutoffDate: toIsoDate(nextCutoff),
    nextExpirationDate,
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

export function calculateReductionPenalty(previousCredits: number, nextCredits: number) {
  if (nextCredits >= previousCredits) {
    return 0;
  }

  return Math.ceil((previousCredits - nextCredits) * REDUCTION_PENALTY_RATE);
}
