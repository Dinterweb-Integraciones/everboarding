import {
  SALES_PROPOSAL_BASE_CREDITS,
  SALES_PROPOSAL_BASE_PRICE,
} from "@/lib/constants";
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
  workspaceVariant?: "hubspot" | "dinterweb";
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
  appliedCouponId: string | null;
  appliedCouponCode: string;
  couponAppliedAt: string | null;
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
    workspaceVariant: "hubspot",
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
    contractedCredits: SALES_PROPOSAL_BASE_CREDITS,
    quotedPrice: SALES_PROPOSAL_BASE_PRICE,
    currency: "usd",
    billingMode: "one_time",
    periodMonths: 1,
    status: "draft",
    hubspotDealId: null,
    activatedClientId: null,
    appliedCouponId: null,
    appliedCouponCode: "",
    couponAppliedAt: null,
    initiatives: [],
  };
}

function normalizeSalesBillingMode(value: unknown): "subscription" | "one_time" {
  return value === "subscription" ? "subscription" : "one_time";
}

function normalizeSalesPeriodMonths(value: unknown): 1 | 3 | 6 | 12 {
  return value === 3 || value === 6 || value === 12 ? value : 1;
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
    workspaceVariant: input.workspaceVariant === "dinterweb" ? "dinterweb" : "hubspot",
    billingMode: normalizeSalesBillingMode(input.billingMode ?? base.billingMode),
    appliedCouponId: input.appliedCouponId || null,
    appliedCouponCode: input.appliedCouponCode || "",
    couponAppliedAt: input.couponAppliedAt || null,
    periodMonths: normalizeSalesPeriodMonths(input.periodMonths ?? base.periodMonths),
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
  const rowClientName = String(row.client_name ?? snapshot.clientName ?? "").trim();
  const rowClientCompany = String(row.client_company ?? snapshot.clientCompany ?? "").trim();
  const resolvedClientName =
    rowClientName && rowClientName.toLowerCase() !== "cliente"
      ? rowClientName
      : rowClientCompany || rowClientName || "Cliente";
  const resolvedClientCompany = rowClientCompany || resolvedClientName;

  return {
    ...snapshot,
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title ?? snapshot.title),
    sellerName: String(row.seller_name ?? snapshot.sellerName ?? ""),
    sellerEmail: String(row.seller_email ?? snapshot.sellerEmail ?? ""),
    sellerCompany: String(row.seller_company ?? snapshot.sellerCompany ?? ""),
    clientName: resolvedClientName,
    clientEmail: String(row.client_email ?? snapshot.clientEmail ?? ""),
    clientCompany: resolvedClientCompany,
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
    billingMode: normalizeSalesBillingMode(
      (row.billing_mode as string | null | undefined) ?? snapshot.billingMode,
    ),
    periodMonths: normalizeSalesPeriodMonths(
      (row.plan_period_months as number | null | undefined) ?? snapshot.periodMonths,
    ),
    status: normalizeSalesStatus(row.status),
    hubspotDealId: (row.hubspot_deal_id as string | null) ?? null,
    activatedClientId: (row.activated_client_id as string | null) ?? null,
    appliedCouponId: (row.applied_coupon_id as string | null) ?? null,
    appliedCouponCode: String(row.applied_coupon_code ?? snapshot.appliedCouponCode ?? ""),
    couponAppliedAt: (row.coupon_applied_at as string | null) ?? snapshot.couponAppliedAt ?? null,
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
    paidAt: (row.paid_at as string | null) ?? null,
    activatedAt: (row.activated_at as string | null) ?? null,
  };
}

export function serializeSalesProposalDraft(draft: SalesProposalDraft) {
  const normalized = normalizeSalesProposalDraft(draft);
  const clientName = normalized.clientName.trim();
  const clientCompany = normalized.clientCompany.trim() || clientName;

  return {
    title: normalized.title.trim() || "Propuesta comercial",
    seller_name: normalized.sellerName.trim() || null,
    seller_email: normalized.sellerEmail.trim() || null,
    seller_company: normalized.sellerCompany.trim() || null,
    client_name: clientName || "Cliente",
    client_email: normalized.clientEmail.trim() || null,
    client_company: clientCompany || null,
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
    applied_coupon_id: normalized.appliedCouponId,
    applied_coupon_code: normalized.appliedCouponCode.trim() || null,
    coupon_applied_at: normalized.couponAppliedAt,
    snapshot: normalized,
  };
}

function isMissingClientName(value: string) {
  const normalized = value.trim().toLowerCase();
  return !normalized || normalized === "cliente";
}

function formatActivationFieldList(fields: string[]) {
  if (fields.length <= 1) {
    return fields[0] ?? "";
  }

  if (fields.length === 2) {
    return `${fields[0]} y ${fields[1]}`;
  }

  return `${fields.slice(0, -1).join(", ")} y ${fields[fields.length - 1]}`;
}

export function getSalesProposalActivationValidation(
  draft: Pick<
    SalesProposalDraft,
    | "clientName"
    | "clientEmail"
    | "startDate"
    | "contractedCredits"
    | "quotedPrice"
    | "appliedCouponCode"
    | "initiatives"
  >,
) {
  const missingFields: string[] = [];
  const hasAppliedCoupon = Boolean(draft.appliedCouponCode?.trim());

  if (isMissingClientName(draft.clientName)) {
    missingFields.push("el nombre del cliente");
  }

  if (!draft.clientEmail.trim()) {
    missingFields.push("el email del cliente");
  }

  if (!draft.startDate.trim()) {
    missingFields.push("la fecha de inicio");
  }

  if (safeParseNumber(draft.contractedCredits) <= 0) {
    missingFields.push("los creditos contratados");
  }

  if (safeParseNumber(draft.quotedPrice) <= 0 && !hasAppliedCoupon) {
    missingFields.push("la inversion");
  }

  const hasPlan = draft.initiatives.some((initiative) => initiative.subitems.length > 0);
  const isValid = missingFields.length === 0 && hasPlan;
  let message = "";

  if (missingFields.length && !hasPlan) {
    message = `Completa ${formatActivationFieldList(missingFields)} y agrega al menos una iniciativa antes de activar el plan.`;
  } else if (missingFields.length) {
    message = `Completa ${formatActivationFieldList(missingFields)} antes de activar el plan.`;
  } else if (!hasPlan) {
    message = "Agrega al menos una iniciativa antes de activar el plan.";
  }

  return {
    isValid,
    hasPlan,
    missingFields,
    message,
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

export function generateSalesProposalSlug(
  input: Pick<SalesProposalDraft, "clientCompany" | "clientName" | "clientEmail" | "title">,
) {
  const normalizedCompany = input.clientCompany.trim().toLowerCase();
  const normalizedClientName = input.clientName.trim().toLowerCase();
  const emailLocalPart = input.clientEmail.trim().split("@")[0] ?? "";
  const companySlug =
    !normalizedCompany || normalizedCompany === "cliente" ? "" : slugify(input.clientCompany);
  const clientSlug =
    !normalizedClientName || normalizedClientName === "cliente" ? "" : slugify(input.clientName);
  const emailSlug = slugify(emailLocalPart);
  const base = companySlug || clientSlug || emailSlug || slugify(input.title) || "propuesta";

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
