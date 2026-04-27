import {
  calculateCredits,
  calculateInitiativeProgress,
  formatDateRange,
  type AssignableUser,
  type CreditCatalogItem,
  type InitiativeStatus,
  type InitiativeTaskStatus,
} from "@/lib/onboarding";
import { safeParseNumber, slugify, toIsoDate } from "@/lib/utils";
import type { Database } from "@/types/database";

type SalesProposalRow = Database["public"]["Tables"]["sales_proposals"]["Row"];

export type SalesProposalStatus =
  | "draft"
  | "checkout_pending"
  | "paid"
  | "board_activated"
  | "archived";

export type SalesProposalSubitemDraft = {
  id: string;
  catalogItemId: string | null;
  name: string;
  status: InitiativeTaskStatus;
  targetDate: string;
  unitCredits: number;
  quantity: number;
};

export type SalesProposalInitiativeDraft = {
  id: string;
  title: string;
  type: string;
  status: InitiativeStatus;
  description: string;
  estStartDate: string;
  estEndDate: string;
  sortOrder: number;
  isBlocked: boolean;
  subitems: SalesProposalSubitemDraft[];
};

export type SalesProposalDraft = {
  id?: string;
  slug?: string;
  title: string;
  sellerName: string;
  sellerEmail: string;
  sellerCompany: string;
  clientName: string;
  clientEmail: string;
  clientCompany: string;
  clientPhone: string;
  clientDescription: string;
  assignedCsmUserId: string;
  startDate: string;
  contractedCredits: number;
  quotedPrice: number;
  currency: string;
  billingMode: "subscription" | "one_time";
  periodMonths: 1 | 3 | 6 | 12;
  status: SalesProposalStatus;
  hubspotDealId: string | null;
  activatedClientId: string | null;
  initiatives: SalesProposalInitiativeDraft[];
};

export type SalesProposalRecord = SalesProposalDraft & {
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  activatedAt: string | null;
};

export function createLocalId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createEmptySalesProposalDraft(): SalesProposalDraft {
  return {
    title: "Propuesta comercial",
    sellerName: "",
    sellerEmail: "",
    sellerCompany: "",
    clientName: "Cliente",
    clientEmail: "",
    clientCompany: "",
    clientPhone: "",
    clientDescription: "",
    assignedCsmUserId: "",
    startDate: toIsoDate(),
    contractedCredits: 80,
    quotedPrice: 1197,
    currency: "usd",
    billingMode: "subscription",
    periodMonths: 1,
    status: "draft",
    hubspotDealId: null,
    activatedClientId: null,
    initiatives: [],
  };
}

export function createEmptySalesInitiative(status: InitiativeStatus): SalesProposalInitiativeDraft {
  return {
    id: createLocalId("sales-initiative"),
    title: "",
    type: "",
    status,
    description: "",
    estStartDate: "",
    estEndDate: "",
    sortOrder: 0,
    isBlocked: false,
    subitems: [],
  };
}

export function createProposalSubitemFromCatalog(item: CreditCatalogItem): SalesProposalSubitemDraft {
  return {
    id: createLocalId("sales-subitem"),
    catalogItemId: item.id,
    name: item.label,
    status: "pending",
    targetDate: "",
    unitCredits: item.credits,
    quantity: 1,
  };
}

export function normalizeSalesProposalDraft(input: Partial<SalesProposalDraft>): SalesProposalDraft {
  const base = createEmptySalesProposalDraft();

  return {
    ...base,
    ...input,
    currency: (input.currency || base.currency).toLowerCase(),
    periodMonths: normalizeSalesPeriod(input.periodMonths),
    contractedCredits: Math.max(0, safeParseNumber(input.contractedCredits ?? base.contractedCredits)),
    quotedPrice: Math.max(0, safeParseNumber(input.quotedPrice ?? base.quotedPrice)),
    initiatives: (input.initiatives ?? []).map((initiative, initiativeIndex) => ({
      id: initiative.id || createLocalId("sales-initiative"),
      title: initiative.title || "",
      type: initiative.type || "",
      status: initiative.status || "backlog",
      description: initiative.description || "",
      estStartDate: initiative.estStartDate || "",
      estEndDate: initiative.estEndDate || "",
      sortOrder: safeParseNumber(initiative.sortOrder ?? initiativeIndex),
      isBlocked: Boolean(initiative.isBlocked),
      subitems: (initiative.subitems ?? []).map((subitem) => ({
        id: subitem.id || createLocalId("sales-subitem"),
        catalogItemId: subitem.catalogItemId || null,
        name: subitem.name || "",
        status: subitem.status || "pending",
        targetDate: subitem.targetDate || "",
        unitCredits: Math.max(0, safeParseNumber(subitem.unitCredits)),
        quantity: Math.max(1, safeParseNumber(subitem.quantity || 1)),
      })),
    })),
  };
}

export function mapSalesProposalRow(row: SalesProposalRow | Record<string, unknown>): SalesProposalRecord {
  const snapshot = normalizeSalesProposalDraft((row.snapshot as Partial<SalesProposalDraft>) ?? {});

  return {
    ...snapshot,
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title ?? snapshot.title),
    sellerName: String(row.seller_name ?? snapshot.sellerName ?? ""),
    sellerEmail: String(row.seller_email ?? snapshot.sellerEmail ?? ""),
    sellerCompany: String(row.seller_company ?? snapshot.sellerCompany ?? ""),
    clientName: String(row.client_name ?? snapshot.clientName ?? "Cliente"),
    clientEmail: String(row.client_email ?? snapshot.clientEmail ?? ""),
    clientCompany: String(row.client_company ?? snapshot.clientCompany ?? ""),
    clientPhone: String(row.client_phone ?? snapshot.clientPhone ?? ""),
    clientDescription: String(row.client_description ?? snapshot.clientDescription ?? ""),
    assignedCsmUserId: String(row.assigned_csm_user_id ?? snapshot.assignedCsmUserId ?? ""),
    startDate: String(row.start_date ?? snapshot.startDate ?? toIsoDate()),
    contractedCredits: safeParseNumber(
      (row.contracted_credits as string | number | null | undefined) ?? snapshot.contractedCredits,
    ),
    quotedPrice: safeParseNumber(
      (row.quoted_price as string | number | null | undefined) ?? snapshot.quotedPrice,
    ),
    currency: String(row.currency ?? snapshot.currency ?? "usd").toLowerCase(),
    billingMode:
      row.billing_mode === "one_time" || snapshot.billingMode === "one_time"
        ? "one_time"
        : "subscription",
    periodMonths: normalizeSalesPeriod(
      safeParseNumber(
        (row.plan_period_months as string | number | null | undefined) ??
          snapshot.periodMonths ??
          1,
      ),
    ),
    status: normalizeSalesStatus(row.status),
    hubspotDealId: (row.hubspot_deal_id as string | null) ?? null,
    activatedClientId: (row.activated_client_id as string | null) ?? null,
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
    paidAt: (row.paid_at as string | null) ?? null,
    activatedAt: (row.activated_at as string | null) ?? null,
  };
}

export function serializeSalesProposalDraft(draft: SalesProposalDraft) {
  const normalized = normalizeSalesProposalDraft(draft);

  return {
    title: normalized.title.trim() || "Propuesta comercial",
    seller_name: normalized.sellerName.trim() || null,
    seller_email: normalized.sellerEmail.trim() || null,
    seller_company: normalized.sellerCompany.trim() || null,
    client_name: normalized.clientName.trim() || "Cliente",
    client_email: normalized.clientEmail.trim() || null,
    client_company: normalized.clientCompany.trim() || null,
    client_phone: normalized.clientPhone.trim() || null,
    client_description: normalized.clientDescription.trim() || null,
    assigned_csm_user_id: normalized.assignedCsmUserId || null,
    start_date: normalized.startDate || toIsoDate(),
    contracted_credits: normalized.contractedCredits,
    quoted_price: normalized.quotedPrice,
    currency: normalized.currency.toLowerCase(),
    billing_mode: normalized.billingMode,
    plan_period_months: normalized.periodMonths,
    status: normalized.status,
    snapshot: normalized,
  };
}

export function calculateSalesProposalMetrics(draft: SalesProposalDraft) {
  const contracted = Math.max(0, safeParseNumber(draft.contractedCredits));
  const completed = draft.initiatives
    .filter((initiative) => initiative.status === "completed")
    .reduce((sum, initiative) => sum + calculateSalesInitiativeCredits(initiative), 0);
  const committed = draft.initiatives
    .filter((initiative) => initiative.status === "planned" || initiative.status === "executing")
    .reduce((sum, initiative) => sum + calculateSalesInitiativeCredits(initiative), 0);

  return {
    total: contracted,
    completed,
    committed,
    available: Math.max(0, contracted - completed - committed),
  };
}

export function calculateSalesInitiativeCredits(initiative: SalesProposalInitiativeDraft) {
  return calculateCredits(
    initiative.subitems.map((subitem) => ({
      unit_credits: subitem.unitCredits,
      quantity: subitem.quantity,
    })),
  );
}

export function calculateSalesInitiativeProgress(initiative: SalesProposalInitiativeDraft) {
  return calculateInitiativeProgress(
    initiative.subitems.map((subitem) => ({
      quantity: subitem.quantity,
      status: subitem.status,
    })),
  );
}

export function getSalesProposalSummary(draft: SalesProposalDraft) {
  const metrics = calculateSalesProposalMetrics(draft);
  const executionWindow = draft.initiatives
    .map((initiative) => formatDateRange(initiative.estStartDate || null, initiative.estEndDate || null))
    .filter((range) => range !== "Sin fechas");

  return {
    metrics,
    executionWindow: executionWindow[0] ?? "Sin fechas",
  };
}

export function buildSalesProposalShareUrl(origin: string, slug: string) {
  return `${origin.replace(/\/$/, "")}/sales/proposals/${slug}`;
}

export function getAssigneeName(users: AssignableUser[], userId: string) {
  return users.find((user) => user.id === userId)?.full_name || users.find((user) => user.id === userId)?.email || "";
}

export function generateSalesProposalSlug(input: Pick<SalesProposalDraft, "clientCompany" | "clientName" | "title">) {
  const base =
    slugify(input.clientCompany) || slugify(input.clientName) || slugify(input.title) || "propuesta";

  return `${base}-${Date.now().toString(36)}`;
}

function normalizeSalesStatus(value: unknown): SalesProposalStatus {
  if (
    value === "checkout_pending" ||
    value === "paid" ||
    value === "board_activated" ||
    value === "archived"
  ) {
    return value;
  }

  return "draft";
}

function normalizeSalesPeriod(value: unknown): 1 | 3 | 6 | 12 {
  if (value === 3 || value === 6 || value === 12) {
    return value;
  }

  return 1;
}
