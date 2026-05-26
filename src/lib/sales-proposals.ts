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

export type SalesCouponType = "package_override" | "percentage";
export type SalesProposalPaymentMethod = "stripe" | "bank_transfer";

export type SalesProposalStatus =
  | "draft"
  | "checkout_pending"
  | "transfer_pending"
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
  paymentMethod: SalesProposalPaymentMethod;
  hubspotDealId: string | null;
  activatedClientId: string | null;
  appliedCouponId: string | null;
  appliedCouponCode: string;
  appliedCouponType: SalesCouponType | null;
  appliedCouponPercentageOff: number | null;
  couponBaseQuotedPrice: number | null;
  couponAppliedAt: string | null;
  transferBank: string;
  transferReference: string;
  transferValidatedAt: string | null;
  transferValidatedByUserId: string | null;
  prospectExtraPackageQuantity: number;
  initiatives: SalesProposalInitiativeDraft[];
};

export type SalesProposalRecord = SalesProposalDraft & {
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  activatedAt: string | null;
};

type CompactSalesProposalSubitemSnapshot = [
  id?: string,
  catalogItemId?: string | null,
  name?: string,
  status?: InitiativeTaskStatus,
  targetDate?: string | null,
  unitCredits?: number,
  quantity?: number,
];

type CompactSalesProposalInitiativeSnapshot = [
  id?: string,
  title?: string,
  type?: string,
  status?: InitiativeStatus,
  description?: string | null,
  estStartDate?: string | null,
  estEndDate?: string | null,
  sortOrder?: number,
  isBlocked?: number | boolean,
  subitems?: CompactSalesProposalSubitemSnapshot[],
];

type CompactSalesProposalSnapshot = {
  w?: "hubspot" | "dinterweb";
  ct?: SalesCouponType | null;
  cp?: number | null;
  cb?: number | null;
  pe?: number | null;
  i?: CompactSalesProposalInitiativeSnapshot[];
};

function createCompactSalesProposalSnapshot(
  draft: Pick<
    SalesProposalDraft,
    | "workspaceVariant"
    | "appliedCouponType"
    | "appliedCouponPercentageOff"
    | "couponBaseQuotedPrice"
    | "prospectExtraPackageQuantity"
    | "initiatives"
  >,
): CompactSalesProposalSnapshot {
  return {
    w: draft.workspaceVariant,
    ct: draft.appliedCouponType,
    cp: draft.appliedCouponPercentageOff,
    cb: draft.couponBaseQuotedPrice,
    pe: draft.prospectExtraPackageQuantity,
    i: draft.initiatives.map((initiative) => [
      initiative.id,
      initiative.title,
      initiative.type,
      initiative.status,
      initiative.description || null,
      initiative.estStartDate || null,
      initiative.estEndDate || null,
      initiative.sortOrder,
      initiative.isBlocked ? 1 : 0,
      initiative.subitems.map((subitem) => [
        subitem.id,
        subitem.catalogItemId,
        subitem.name,
        subitem.status,
        subitem.targetDate || null,
        subitem.unitCredits,
        subitem.quantity,
      ]),
    ]),
  };
}

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
    paymentMethod: "stripe",
    hubspotDealId: null,
    activatedClientId: null,
    appliedCouponId: null,
    appliedCouponCode: "",
    appliedCouponType: null,
    appliedCouponPercentageOff: null,
    couponBaseQuotedPrice: null,
    couponAppliedAt: null,
    transferBank: "",
    transferReference: "",
    transferValidatedAt: null,
    transferValidatedByUserId: null,
    prospectExtraPackageQuantity: 0,
    initiatives: [],
  };
}

export function normalizeSalesPaymentMethod(value: unknown): SalesProposalPaymentMethod {
  return value === "bank_transfer" ? "bank_transfer" : "stripe";
}

function buildDuplicatedSalesProposalTitle(value: string) {
  const normalizedTitle = value.trim() || "Propuesta comercial";
  return /\bcopia\b/i.test(normalizedTitle) ? normalizedTitle : `${normalizedTitle} - Copia`;
}

export function createDuplicatedSalesProposalDraft(
  source: SalesProposalDraft | SalesProposalRecord,
): SalesProposalDraft {
  const normalized = normalizeSalesProposalDraft(source);

  return {
    ...normalized,
    id: undefined,
    slug: undefined,
    title:
      normalized.workspaceVariant === "dinterweb"
        ? "Propuesta comercial"
        : buildDuplicatedSalesProposalTitle(normalized.title),
    clientName: "Cliente",
    clientEmail: "",
    clientCompany: "",
    clientPhone: "",
    clientDescription: "",
    status: "draft",
    assignedCsmUserId: "",
    hubspotDealId: null,
    activatedClientId: null,
    appliedCouponId: null,
    appliedCouponCode: "",
    appliedCouponType: null,
    appliedCouponPercentageOff: null,
    couponBaseQuotedPrice: null,
    couponAppliedAt: null,
    transferBank: "",
    paymentMethod: "stripe",
    transferReference: "",
    transferValidatedAt: null,
    transferValidatedByUserId: null,
    prospectExtraPackageQuantity: 0,
    initiatives: normalized.initiatives.map((initiative, initiativeIndex) => ({
      ...initiative,
      id: createLocalId("sales-initiative"),
      sortOrder: initiative.sortOrder ?? initiativeIndex,
      subitems: initiative.subitems.map((subitem) => ({
        ...subitem,
        id: createLocalId("sales-subitem"),
      })),
    })),
  };
}

export function normalizeSalesCouponType(value: unknown): SalesCouponType {
  return value === "percentage" ? "percentage" : "package_override";
}

export function normalizeCouponPercentageOff(value: unknown) {
  return Math.min(100, Math.max(0, safeParseNumber(value as string | number | null | undefined)));
}

export function applyPercentageDiscount(amount: number, percentageOff: number) {
  const normalizedAmount = Math.max(0, safeParseNumber(amount));
  const normalizedPercentage = normalizeCouponPercentageOff(percentageOff);
  const discountedAmount = normalizedAmount * (1 - normalizedPercentage / 100);

  return Math.round(discountedAmount * 100) / 100;
}

export function applySalesProposalExtraPackages(
  proposal: SalesProposalDraft | SalesProposalRecord,
  option: { credits: number; price: number },
  quantity: number,
): SalesProposalDraft {
  const normalizedProposal = normalizeSalesProposalDraft(proposal);
  const normalizedQuantity = Math.max(0, Math.floor(safeParseNumber(quantity)));

  if (normalizedQuantity <= 0) {
    return normalizedProposal;
  }

  const addedCredits = Math.max(0, safeParseNumber(option.credits)) * normalizedQuantity;
  const addedPrice = Math.max(0, safeParseNumber(option.price)) * normalizedQuantity;
  const baseQuotedPrice =
    normalizedProposal.appliedCouponType === "percentage" &&
    normalizedProposal.couponBaseQuotedPrice !== null
      ? normalizedProposal.couponBaseQuotedPrice
      : normalizedProposal.quotedPrice;
  const nextBaseQuotedPrice = Math.round((baseQuotedPrice + addedPrice) * 100) / 100;
  const nextQuotedPrice =
    normalizedProposal.appliedCouponType === "percentage" &&
    normalizedProposal.appliedCouponPercentageOff
      ? applyPercentageDiscount(nextBaseQuotedPrice, normalizedProposal.appliedCouponPercentageOff)
      : nextBaseQuotedPrice;

  return {
    ...normalizedProposal,
    contractedCredits: normalizedProposal.contractedCredits + addedCredits,
    quotedPrice: nextQuotedPrice,
    prospectExtraPackageQuantity: normalizedProposal.prospectExtraPackageQuantity + normalizedQuantity,
    couponBaseQuotedPrice:
      normalizedProposal.appliedCouponType === "percentage" ? nextBaseQuotedPrice : null,
  };
}

export function setSalesProposalExtraPackages(
  proposal: SalesProposalDraft | SalesProposalRecord,
  option: { credits: number; price: number },
  quantity: number,
): SalesProposalDraft {
  const normalizedProposal = normalizeSalesProposalDraft(proposal);
  const currentQuantity = Math.max(0, Math.floor(safeParseNumber(normalizedProposal.prospectExtraPackageQuantity)));
  const nextQuantity = Math.max(0, Math.floor(safeParseNumber(quantity)));
  const delta = nextQuantity - currentQuantity;

  if (delta === 0) {
    return normalizedProposal;
  }

  const creditsDelta = Math.max(0, safeParseNumber(option.credits)) * delta;
  const priceDelta = Math.max(0, safeParseNumber(option.price)) * delta;
  const baseQuotedPrice =
    normalizedProposal.appliedCouponType === "percentage" &&
    normalizedProposal.couponBaseQuotedPrice !== null
      ? normalizedProposal.couponBaseQuotedPrice
      : normalizedProposal.quotedPrice;
  const nextBaseQuotedPrice = Math.max(0, Math.round((baseQuotedPrice + priceDelta) * 100) / 100);
  const nextQuotedPrice =
    normalizedProposal.appliedCouponType === "percentage" &&
    normalizedProposal.appliedCouponPercentageOff
      ? applyPercentageDiscount(nextBaseQuotedPrice, normalizedProposal.appliedCouponPercentageOff)
      : nextBaseQuotedPrice;

  return {
    ...normalizedProposal,
    contractedCredits: Math.max(0, normalizedProposal.contractedCredits + creditsDelta),
    quotedPrice: nextQuotedPrice,
    prospectExtraPackageQuantity: nextQuantity,
    couponBaseQuotedPrice:
      normalizedProposal.appliedCouponType === "percentage" ? nextBaseQuotedPrice : null,
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

function normalizeSalesProposalSubitemDraft(
  subitem: Partial<SalesProposalSubitemDraft> | CompactSalesProposalSubitemSnapshot,
): SalesProposalSubitemDraft {
  if (Array.isArray(subitem)) {
    return {
      id: subitem[0] || createLocalId("sales-subitem"),
      catalogItemId: subitem[1] || null,
      name: subitem[2] || "",
      status: subitem[3] || "pending",
      targetDate: subitem[4] || "",
      unitCredits: Math.max(0, safeParseNumber(subitem[5])),
      quantity: Math.max(1, safeParseNumber(subitem[6] || 1)),
    };
  }

  return {
    id: subitem.id || createLocalId("sales-subitem"),
    catalogItemId: subitem.catalogItemId || null,
    name: subitem.name || "",
    status: subitem.status || "pending",
    targetDate: subitem.targetDate || "",
    unitCredits: Math.max(0, safeParseNumber(subitem.unitCredits)),
    quantity: Math.max(1, safeParseNumber(subitem.quantity || 1)),
  };
}

function normalizeSalesProposalInitiativeDraft(
  initiative: Partial<SalesProposalInitiativeDraft> | CompactSalesProposalInitiativeSnapshot,
  initiativeIndex: number,
): SalesProposalInitiativeDraft {
  if (Array.isArray(initiative)) {
    return {
      id: initiative[0] || createLocalId("sales-initiative"),
      title: initiative[1] || "",
      type: initiative[2] || "",
      status: initiative[3] || "backlog",
      description: initiative[4] || "",
      estStartDate: initiative[5] || "",
      estEndDate: initiative[6] || "",
      sortOrder: safeParseNumber(initiative[7] ?? initiativeIndex),
      isBlocked: Boolean(initiative[8]),
      subitems: (initiative[9] ?? []).map((subitem) => normalizeSalesProposalSubitemDraft(subitem)),
    };
  }

  return {
    id: initiative.id || createLocalId("sales-initiative"),
    title: initiative.title || "",
    type: initiative.type || "",
    status: initiative.status || "backlog",
    description: initiative.description || "",
    estStartDate: initiative.estStartDate || "",
    estEndDate: initiative.estEndDate || "",
    sortOrder: safeParseNumber(initiative.sortOrder ?? initiativeIndex),
    isBlocked: Boolean(initiative.isBlocked),
    subitems: (initiative.subitems ?? []).map((subitem) => normalizeSalesProposalSubitemDraft(subitem)),
  };
}

export function normalizeSalesProposalDraft(
  input: Partial<SalesProposalDraft> & CompactSalesProposalSnapshot,
): SalesProposalDraft {
  const base = createEmptySalesProposalDraft();
  const couponType = input.appliedCouponType ?? input.ct ?? null;
  const couponPercentageOff = input.appliedCouponPercentageOff ?? input.cp;
  const couponBaseQuotedPrice = input.couponBaseQuotedPrice ?? input.cb;
  const rawInitiatives = Array.isArray(input.initiatives)
    ? input.initiatives
    : Array.isArray(input.i)
      ? input.i
      : [];

  return {
    ...base,
    ...input,
    currency: (input.currency || base.currency).toLowerCase(),
    paymentMethod: normalizeSalesPaymentMethod(input.paymentMethod ?? base.paymentMethod),
    workspaceVariant:
      input.workspaceVariant === "dinterweb" || input.w === "dinterweb" ? "dinterweb" : "hubspot",
    billingMode: normalizeSalesBillingMode(input.billingMode ?? base.billingMode),
    appliedCouponId: input.appliedCouponId || null,
    appliedCouponCode: input.appliedCouponCode || "",
    appliedCouponType: couponType ? normalizeSalesCouponType(couponType) : null,
    appliedCouponPercentageOff:
      couponPercentageOff === null || couponPercentageOff === undefined
        ? null
        : normalizeCouponPercentageOff(couponPercentageOff),
    couponBaseQuotedPrice:
      couponBaseQuotedPrice === null || couponBaseQuotedPrice === undefined
        ? null
        : Math.max(0, safeParseNumber(couponBaseQuotedPrice)),
    couponAppliedAt: input.couponAppliedAt || null,
    transferBank: String(input.transferBank ?? base.transferBank ?? ""),
    transferReference: String(input.transferReference ?? base.transferReference ?? ""),
    transferValidatedAt:
      typeof input.transferValidatedAt === "string" && input.transferValidatedAt.trim()
        ? input.transferValidatedAt
        : null,
    transferValidatedByUserId:
      typeof input.transferValidatedByUserId === "string" && input.transferValidatedByUserId.trim()
        ? input.transferValidatedByUserId
        : null,
    prospectExtraPackageQuantity: Math.max(
      0,
      Math.floor(safeParseNumber(input.prospectExtraPackageQuantity ?? input.pe ?? base.prospectExtraPackageQuantity)),
    ),
    periodMonths: normalizeSalesPeriodMonths(input.periodMonths ?? base.periodMonths),
    contractedCredits: Math.max(0, safeParseNumber(input.contractedCredits ?? base.contractedCredits)),
    quotedPrice: Math.max(0, safeParseNumber(input.quotedPrice ?? base.quotedPrice)),
    initiatives: rawInitiatives.map((initiative, initiativeIndex) =>
      normalizeSalesProposalInitiativeDraft(initiative, initiativeIndex),
    ),
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
    paymentMethod: normalizeSalesPaymentMethod(row.payment_method),
    hubspotDealId: (row.hubspot_deal_id as string | null) ?? null,
    activatedClientId: (row.activated_client_id as string | null) ?? null,
    appliedCouponId: (row.applied_coupon_id as string | null) ?? null,
    appliedCouponCode: String(row.applied_coupon_code ?? snapshot.appliedCouponCode ?? ""),
    appliedCouponType: snapshot.appliedCouponType ? normalizeSalesCouponType(snapshot.appliedCouponType) : null,
    appliedCouponPercentageOff:
      snapshot.appliedCouponPercentageOff === null || snapshot.appliedCouponPercentageOff === undefined
        ? null
        : normalizeCouponPercentageOff(snapshot.appliedCouponPercentageOff),
    couponBaseQuotedPrice:
      snapshot.couponBaseQuotedPrice === null || snapshot.couponBaseQuotedPrice === undefined
        ? null
        : Math.max(0, safeParseNumber(snapshot.couponBaseQuotedPrice)),
    couponAppliedAt: (row.coupon_applied_at as string | null) ?? snapshot.couponAppliedAt ?? null,
    transferBank: String((row as Record<string, unknown>).transfer_bank ?? snapshot.transferBank ?? ""),
    transferReference: String(row.transfer_reference ?? snapshot.transferReference ?? ""),
    transferValidatedAt: (row.transfer_validated_at as string | null) ?? snapshot.transferValidatedAt ?? null,
    transferValidatedByUserId:
      (row.transfer_validated_by_user_id as string | null) ?? snapshot.transferValidatedByUserId ?? null,
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
  const snapshot = createCompactSalesProposalSnapshot({
    ...normalized,
    initiatives: [],
  });

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
    payment_method: normalized.paymentMethod,
    applied_coupon_id: normalized.appliedCouponId,
    applied_coupon_code: normalized.appliedCouponCode.trim() || null,
    coupon_applied_at: normalized.couponAppliedAt,
    transfer_bank: normalized.transferBank.trim() || null,
    transfer_reference: normalized.transferReference.trim() || null,
    transfer_validated_at: normalized.transferValidatedAt,
    transfer_validated_by_user_id: normalized.transferValidatedByUserId,
    snapshot,
  };
}

export function serializeSalesProposalFullSnapshot(draft: SalesProposalDraft) {
  return createCompactSalesProposalSnapshot(normalizeSalesProposalDraft(draft));
}

function isMissingClientName(value: string) {
  const normalized = value.trim().toLowerCase();
  return !normalized || normalized === "cliente";
}

export function isValidSalesProposalClientEmail(value: string) {
  const normalized = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
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

  if (!isValidSalesProposalClientEmail(draft.clientEmail)) {
    missingFields.push("un correo valido del cliente");
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

function createSalesProposalSlugSuffix() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  }

  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
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

  return `${base}-${createSalesProposalSlugSuffix()}`;
}

function normalizeSalesStatus(value: unknown): SalesProposalStatus {
  if (
    value === "checkout_pending" ||
    value === "transfer_pending" ||
    value === "paid" ||
    value === "board_activated" ||
    value === "archived"
  ) {
    return value;
  }

  return "draft";
}
