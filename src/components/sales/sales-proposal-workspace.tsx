"use client";

import { CalendarDays, Download, Link2, Loader2, Minus, Plus, Search, SlidersHorizontal, Sparkles, Trash2, X } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { BrandLogo } from "@/components/layout/brand-logo";
import {
  PlanReportExportPages,
  exportPlanReportPdf,
  type PlanReportInitiative,
} from "@/components/onboarding/plan-report-export";
import { FeedbackToast } from "@/components/ui/feedback-toast";
import { RichTextDisplay, RichTextTextarea, richTextToPlainText } from "@/components/ui/rich-text";
import { reorderBoardItems, type DropPosition } from "@/lib/board-order";
import {
  SALES_PROPOSAL_BASE_CREDITS,
  SALES_PROPOSAL_BASE_PRICE,
  SALES_PROPOSAL_UPSELL_OPTIONS,
  STATUS_META,
  TASK_STATUS_META,
} from "@/lib/constants";
import {
  applyPercentageDiscount,
  createProposalSubitemFromCatalog,
  createEmptySalesInitiative,
  createEmptySalesProposalDraft,
  createLocalId,
  getDefaultSalesCreditValidityDays,
  getSalesProposalActivationValidation,
  generateSalesProposalSlug,
  isValidSalesProposalClientEmail,
  normalizeSalesProposalDraft,
  type SalesCouponType,
  type SalesProposalDraft,
  type SalesProposalInitiativeDraft,
  type SalesProposalRecord,
  calculateSalesInitiativeCredits,
  calculateSalesInitiativeProgress,
  calculateSalesProposalMetrics,
} from "@/lib/sales-proposals";
import {
  buildCatalogGroupOptions,
  buildCatalogModalGroups,
  formatDateRange,
  getPlanCadenceLabel,
  type CatalogModalGroup,
  type CreditCatalogGroup,
  type CreditCatalogGroupCategory,
  type CreditCatalogGroupCategoryLink,
  type CreditCatalogGroupItem,
  type CreditCatalogItem,
  type InitiativeStatus,
} from "@/lib/onboarding";
import { formatCurrency, formatUserError, safeParseNumber, toIsoDate } from "@/lib/utils";

type SalesProposalWorkspaceProps = {
  initialCatalog: CreditCatalogItem[];
  initialGroups: CreditCatalogGroup[];
  initialGroupCategories: CreditCatalogGroupCategory[];
  initialGroupCategoryLinks: CreditCatalogGroupCategoryLink[];
  initialGroupMemberships: CreditCatalogGroupItem[];
  initialProposal?: SalesProposalDraft | SalesProposalRecord | null;
  variant?: "hubspot" | "dinterweb";
  routeBase?: string;
  sellerPreset?: {
    name: string;
    email: string;
    company: string;
  } | null;
  canWaiveAnyInitiative?: boolean;
};

function matchesCatalogGroupSearch(group: CatalogModalGroup, query: string) {
  const normalizedQuery = normalizeCatalogText(query);
  if (!normalizedQuery) return true;

  const searchableText = [
    group.name,
    group.preview,
    group.description,
    group.completionOutcome,
    group.successMilestone,
    group.modalCategory,
    group.displayBadge,
    ...group.tags,
    ...group.items.map((item) => `${item.label} ${item.category}`),
  ]
    .map((value) => normalizeCatalogText(richTextToPlainText(value)))
    .join(" ");

  return searchableText.includes(normalizedQuery);
}

function getCatalogGroupPreview(group: CatalogModalGroup, fallback: string) {
  return richTextToPlainText(group.preview) || richTextToPlainText(group.description) || fallback;
}

function getPlainInitiativeDescription(value: string | null | undefined, fallback = "Sin descripcion ejecutiva.") {
  return richTextToPlainText(value) || fallback;
}

function getCatalogGroupInitiativeDescription(group: CatalogModalGroup) {
  return getPlainInitiativeDescription(
    group.description,
    `Grupo de casos de uso recomendado para ${group.modalCategory}.`,
  );
}

function findCatalogGroupForInitiative(
  initiative: Pick<SalesProposalInitiativeDraft, "title" | "type" | "subitems">,
  groups: CatalogModalGroup[],
) {
  const normalizedTitle = normalizeCatalogText(initiative.title);
  const normalizedType = normalizeCatalogText(initiative.type);
  const subitemCatalogIds = new Set(
    initiative.subitems.flatMap((subitem) => (subitem.catalogItemId ? [subitem.catalogItemId] : [])),
  );

  const titleMatches = groups.filter((group) => normalizeCatalogText(group.name) === normalizedTitle);
  const typedTitleMatch = titleMatches.find((group) => normalizeCatalogText(group.modalCategory) === normalizedType);
  if (typedTitleMatch) return typedTitleMatch;
  if (titleMatches[0]) return titleMatches[0];

  if (!subitemCatalogIds.size) return null;

  return (
    groups.find((group) => {
      const groupItemIds = new Set(group.items.map((item) => item.id));
      return [...subitemCatalogIds].every((itemId) => groupItemIds.has(itemId));
    }) ?? null
  );
}

type WizardRecommendationStatus = Extract<InitiativeStatus, "backlog" | "planned" | "executing">;

type WizardRecommendation = {
  groupId: string;
  status: WizardRecommendationStatus;
  reason?: string;
  startDate?: string;
  endDate?: string;
};

type WizardRecommendationResponse = {
  summary?: string;
  recommendations?: Array<{
    group_id?: string;
    status?: string;
    reason?: string;
    start_date?: string;
    end_date?: string;
  }>;
  message?: string;
};

const boardStatuses: InitiativeStatus[] = ["backlog", "planned", "executing", "completed"];
const summaryStatuses: InitiativeStatus[] = ["executing", "planned", "backlog", "completed"];
const mobileBoardStatusOrderClasses: Record<InitiativeStatus, string> = {
  executing: "order-1",
  planned: "order-2",
  backlog: "order-3",
  completed: "order-4",
};
const DINTERWEB_MIN_PACKAGE = {
  credits: 60,
  price: SALES_PROPOSAL_BASE_PRICE,
} as const;
const DINTERWEB_DEFAULT_PACKAGE = {
  credits: 80,
  price: 1197,
} as const;
const EVALUATION_VALIDATION_META = {
  reviewing: {
    label: "En revisión",
    className: "border-[#facc15] bg-[#fef9c3] text-[#854d0e]",
  },
  validated: {
    label: "Validado",
    className: "border-[#99f6e4] bg-[#ecfffb] text-[#008f7f]",
  },
} as const;
const SHOW_CATALOG_WIZARD_TAB = false;
const WIZARD_HUB_OPTIONS = ["Sales", "Marketing", "Service", "Content"] as const;
const WIZARD_LOADING_MESSAGES = [
  "Analizando el contexto brindado...",
  "Definiendo prioridades...",
  "Organizando Plan de Trabajo...",
  "Afinando ultimos detalles...",
];
async function parseJsonResponse<T>(response: Response) {
  const rawText = await response.text();
  const trimmed = rawText.trim();

  if (!trimmed) {
    return {} as T;
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error(
      `La API devolvio JSON invalido (${response.status}). Respuesta inicial: ${trimmed.slice(0, 400)}`,
    );
  }
}

function getDinterwebChargeMultiplier(
  billingMode: SalesProposalDraft["billingMode"],
  periodMonths: SalesProposalDraft["periodMonths"],
) {
  return billingMode === "subscription" ? periodMonths : 1;
}

function getDinterwebMonthlyCredits(proposal: Pick<SalesProposalDraft, "contractedCredits" | "billingMode" | "periodMonths">) {
  return Math.max(
    0,
    Math.round(proposal.contractedCredits / getDinterwebChargeMultiplier(proposal.billingMode, proposal.periodMonths)),
  );
}

function getDinterwebMonthlyPrice(proposal: Pick<SalesProposalDraft, "quotedPrice" | "billingMode" | "periodMonths">) {
  return Math.max(
    0,
    Math.round(proposal.quotedPrice / getDinterwebChargeMultiplier(proposal.billingMode, proposal.periodMonths)),
  );
}

function inferDinterwebPackageCreditsStep(monthlyCredits: number) {
  if (monthlyCredits > DINTERWEB_MIN_PACKAGE.credits && monthlyCredits % 80 === 0 && monthlyCredits % 60 !== 0) {
    return 80;
  }

  return DINTERWEB_MIN_PACKAGE.credits;
}

function inferDinterwebPackagePriceStep(monthlyCredits: number, monthlyPrice: number) {
  const creditsStep = inferDinterwebPackageCreditsStep(monthlyCredits);
  const packageCount = Math.max(1, Math.round(monthlyCredits / creditsStep));

  return Math.max(DINTERWEB_MIN_PACKAGE.price, Math.round(monthlyPrice / packageCount));
}

function getStatusDot(status: InitiativeStatus) {
  if (status === "executing") return "bg-[#00bda5]";
  if (status === "planned") return "bg-[#6a78d1]";
  if (status === "completed") return "bg-[#33475b]";
  return "bg-[#cbd6e2]";
}

function getStatusLabel(status: InitiativeStatus) {
  return STATUS_META[status].label;
}

function getStatusHeadingClass(status: InitiativeStatus) {
  if (status === "executing") return "text-[#00bda5]";
  if (status === "planned") return "text-[#6a78d1]";
  if (status === "completed") return "text-[#33475b]";
  return "text-[#516f90]";
}

function getMobileBoardStatusOrderClass(status: InitiativeStatus) {
  return `${mobileBoardStatusOrderClasses[status]} xl:order-none`;
}

function getSalesTimelineBarClass(status: InitiativeStatus) {
  if (status === "executing") {
    return "bg-[#14b8a6] text-white shadow-[0_6px_14px_rgba(20,184,166,0.18)]";
  }

  if (status === "planned") {
    return "bg-[#6a78d1] text-white shadow-[0_6px_14px_rgba(106,120,209,0.18)]";
  }

  if (status === "completed") {
    return "bg-[#33475b] text-white shadow-[0_6px_14px_rgba(51,71,91,0.16)]";
  }

  return "border border-dashed border-[#8ea2bd] bg-white text-[#5f7695] shadow-none";
}

function canManageSalesStage(status: InitiativeStatus) {
  return status === "backlog" || status === "planned";
}

function canMoveSalesInitiativeToStatus(
  currentStatus: InitiativeStatus,
  targetStatus: InitiativeStatus,
) {
  return (
    canManageSalesStage(currentStatus) &&
    canManageSalesStage(targetStatus) &&
    currentStatus !== targetStatus
  );
}

function canDropSalesInitiativeIntoStatus(
  currentStatus: InitiativeStatus,
  targetStatus: InitiativeStatus,
) {
  return currentStatus === targetStatus || canMoveSalesInitiativeToStatus(currentStatus, targetStatus);
}

function getAllowedSalesStageTargets(currentStatus: InitiativeStatus) {
  return boardStatuses.filter((status) => canMoveSalesInitiativeToStatus(currentStatus, status));
}

function normalizeBoardSortOrders(initiatives: SalesProposalInitiativeDraft[]) {
  return boardStatuses.flatMap((status) =>
    initiatives
      .filter((initiative) => initiative.status === status)
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((initiative, index) => ({
        ...initiative,
        sortOrder: index,
      })),
  );
}

function hasSalesProposalIdentity(value: Pick<SalesProposalDraft, "clientName" | "clientDomain">) {
  const normalizedName = value.clientName.trim().toLowerCase();
  return (normalizedName !== "" && normalizedName !== "cliente") || value.clientDomain.trim() !== "";
}

function canPersistSalesProposal(value: Pick<SalesProposalDraft, "slug" | "clientName" | "clientEmail" | "clientDomain">) {
  return isValidSalesProposalClientEmail(value.clientEmail) && (Boolean(value.slug) || hasSalesProposalIdentity(value));
}

function getSalesProposalAutosaveSignature(proposal: SalesProposalDraft) {
  const normalized = normalizeSalesProposalDraft(proposal);

  return JSON.stringify({
    workspaceVariant: normalized.workspaceVariant,
    title: normalized.title,
    sellerName: normalized.sellerName,
    sellerEmail: normalized.sellerEmail,
    sellerCompany: normalized.sellerCompany,
    clientName: normalized.clientName,
    clientEmail: normalized.clientEmail,
    clientCompany: normalized.clientCompany,
    clientDomain: normalized.clientDomain,
    clientPhone: normalized.clientPhone,
    clientDescription: normalized.clientDescription,
    assignedCsmUserId: normalized.assignedCsmUserId,
    startDate: normalized.startDate,
    contractedCredits: normalized.contractedCredits,
    quotedPrice: normalized.quotedPrice,
    currency: normalized.currency,
    billingMode: normalized.billingMode,
    periodMonths: normalized.periodMonths,
    creditValidityDays: normalized.creditValidityDays,
    status: normalized.status,
    appliedCouponId: normalized.appliedCouponId,
    appliedCouponCode: normalized.appliedCouponCode,
    appliedCouponType: normalized.appliedCouponType,
    appliedCouponPercentageOff: normalized.appliedCouponPercentageOff,
    couponBaseContractedCredits: normalized.couponBaseContractedCredits,
    couponBaseQuotedPrice: normalized.couponBaseQuotedPrice,
    couponAppliedAt: normalized.couponAppliedAt,
    initiatives: normalized.initiatives,
  });
}

function mergePersistedProposalIntoCurrent(
  current: SalesProposalDraft,
  persisted: SalesProposalDraft,
) {
  return normalizeSalesProposalDraft({
    ...current,
    id: persisted.id,
    slug: persisted.slug,
    workspaceVariant: persisted.workspaceVariant || current.workspaceVariant,
    status: persisted.status,
    hubspotDealId: persisted.hubspotDealId,
    activatedClientId: persisted.activatedClientId,
    assignedCsmUserId: persisted.assignedCsmUserId || current.assignedCsmUserId,
    appliedCouponId: persisted.appliedCouponId,
    appliedCouponCode: persisted.appliedCouponCode,
    appliedCouponType: persisted.appliedCouponType,
    appliedCouponPercentageOff: persisted.appliedCouponPercentageOff,
    couponBaseContractedCredits: persisted.couponBaseContractedCredits,
    couponBaseQuotedPrice: persisted.couponBaseQuotedPrice,
    couponAppliedAt: persisted.couponAppliedAt,
  });
}

function applyActiveCouponPricing(
  proposal: SalesProposalDraft,
  baseQuotedPrice = proposal.quotedPrice,
) {
  if (proposal.appliedCouponType !== "percentage" || !proposal.appliedCouponPercentageOff) {
    return {
      ...proposal,
      couponBaseContractedCredits: proposal.appliedCouponType ? proposal.couponBaseContractedCredits : null,
      couponBaseQuotedPrice: proposal.appliedCouponType ? proposal.couponBaseQuotedPrice : null,
    };
  }

  return {
    ...proposal,
    quotedPrice: applyPercentageDiscount(baseQuotedPrice, proposal.appliedCouponPercentageOff),
    couponBaseContractedCredits: proposal.couponBaseContractedCredits ?? proposal.contractedCredits,
    couponBaseQuotedPrice: baseQuotedPrice,
  };
}

function clearProspectExtraPackages(proposal: SalesProposalDraft) {
  return {
    ...proposal,
    prospectExtraPackageQuantity: 0,
  };
}

function parseCalendarDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function addCalendarDays(value: Date, amount: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + amount);
  return next;
}

function getDropPosition(event: { clientY: number; currentTarget: EventTarget & HTMLElement }): DropPosition {
  const bounds = event.currentTarget.getBoundingClientRect();
  return event.clientY >= bounds.top + bounds.height / 2 ? "after" : "before";
}

function addCalendarMonths(value: Date, amount: number) {
  return new Date(value.getFullYear(), value.getMonth() + amount, 1);
}

function addRollingCalendarMonths(value: Date, amount: number) {
  const targetMonthStart = new Date(value.getFullYear(), value.getMonth() + amount, 1);
  const targetMonthLastDay = new Date(
    targetMonthStart.getFullYear(),
    targetMonthStart.getMonth() + 1,
    0,
  ).getDate();

  return new Date(
    targetMonthStart.getFullYear(),
    targetMonthStart.getMonth(),
    Math.min(value.getDate(), targetMonthLastDay),
  );
}

function startOfCalendarMonth(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

function buildRollingTimelineMonthSegments(windowStart: Date, windowEnd: Date) {
  const segments: Array<{ key: string; label: string; days: number }> = [];
  let cursor = new Date(windowStart.getFullYear(), windowStart.getMonth(), windowStart.getDate());

  while (cursor < windowEnd) {
    const nextMonthStart = addCalendarMonths(startOfCalendarMonth(cursor), 1);
    const segmentEnd = nextMonthStart < windowEnd ? nextMonthStart : windowEnd;

    segments.push({
      key: `${cursor.getFullYear()}-${cursor.getMonth() + 1}-${cursor.getDate()}`,
      label: new Intl.DateTimeFormat("es-NI", {
        month: "long",
        year: "numeric",
      }).format(cursor),
      days: Math.max(diffCalendarDays(cursor, segmentEnd), 1),
    });

    cursor = segmentEnd;
  }

  return segments;
}

function diffCalendarDays(left: Date, right: Date) {
  const leftCopy = new Date(left.getFullYear(), left.getMonth(), left.getDate());
  const rightCopy = new Date(right.getFullYear(), right.getMonth(), right.getDate());
  return Math.round((rightCopy.getTime() - leftCopy.getTime()) / (1000 * 60 * 60 * 24));
}

function getSnappedDayDelta(deltaX: number, dayWidth: number) {
  if (dayWidth <= 0) return 0;
  return Math.round(deltaX / dayWidth);
}

function createEditorDraft(initiative: SalesProposalInitiativeDraft) {
  return {
    ...initiative,
    description: getPlainInitiativeDescription(initiative.description, ""),
    subitems: initiative.subitems.map((subitem) => ({ ...subitem })),
  };
}

function normalizeCatalogText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isKickoffInitiative(initiative: Pick<SalesProposalInitiativeDraft, "title">) {
  return normalizeCatalogText(initiative.title).includes("kickoff");
}

function isFundamentalInitiative(initiative: Pick<SalesProposalInitiativeDraft, "type">) {
  return normalizeCatalogText(initiative.type) === normalizeCatalogText("Fundamentales");
}

function canToggleCommercialWaiver(
  initiative: Pick<SalesProposalInitiativeDraft, "status" | "type">,
  canWaiveAnyInitiative: boolean,
) {
  return (
    initiative.status === "planned" &&
    (canWaiveAnyInitiative || isFundamentalInitiative(initiative))
  );
}

function calculateSalesInitiativeOriginalCredits(initiative: SalesProposalInitiativeDraft) {
  return initiative.subitems.reduce(
    (total, subitem) =>
      total + safeParseNumber(subitem.unitCredits) * safeParseNumber(subitem.quantity),
    0,
  );
}

function createDefaultKickoffInitiative(startDate: string, sortOrder = 0): SalesProposalInitiativeDraft {
  const kickoffStartDate = startDate || toIsoDate();
  const kickoffEndDate = toIsoDate(addCalendarDays(parseCalendarDate(kickoffStartDate), 5));
  const kickoff = createEmptySalesInitiative("executing");

  kickoff.id = createLocalId("sales-initiative");
  kickoff.title = "Sesión Kickoff";
  kickoff.type = "Implementación";
  kickoff.description =
    "Alineación estratégica inicial para definir prioridades y próximos pasos.";
  kickoff.estStartDate = kickoffStartDate;
  kickoff.estEndDate = kickoffEndDate;
  kickoff.sortOrder = sortOrder;

  return kickoff;
}

function createNewSalesProposalDraft(
  variant: "hubspot" | "dinterweb" = "hubspot",
  sellerPreset?: SalesProposalWorkspaceProps["sellerPreset"],
) {
  const draft = createEmptySalesProposalDraft();
  const commercialDefaults =
    variant === "dinterweb"
      ? {
          contractedCredits: DINTERWEB_DEFAULT_PACKAGE.credits,
          quotedPrice: DINTERWEB_DEFAULT_PACKAGE.price,
        }
      : {};

  return {
    ...draft,
    ...commercialDefaults,
    workspaceVariant: variant,
    sellerName: sellerPreset?.name ?? draft.sellerName,
    sellerEmail: sellerPreset?.email ?? draft.sellerEmail,
    sellerCompany: sellerPreset?.company ?? draft.sellerCompany,
    initiatives: [createDefaultKickoffInitiative(draft.startDate, 0)],
  };
}

function getSuggestedInitiativeDurationDays(initiative: SalesProposalInitiativeDraft) {
  const creditsDuration = Math.ceil(calculateSalesInitiativeCredits(initiative) / 20);
  const subitemsDuration = Math.max(initiative.subitems.length, 1);

  return Math.max(3, Math.min(7, Math.max(creditsDuration, subitemsDuration)));
}

function getCurrentHubspotUpsellCount(
  proposal: Pick<
    SalesProposalDraft,
    "contractedCredits" | "quotedPrice" | "appliedCouponType" | "couponBaseQuotedPrice"
  >,
  option: Pick<(typeof SALES_PROPOSAL_UPSELL_OPTIONS)[number], "credits" | "price">,
) {
  const extraCredits = Math.max(0, proposal.contractedCredits - SALES_PROPOSAL_BASE_CREDITS);
  const effectiveQuotedPrice =
    proposal.appliedCouponType === "percentage" && proposal.couponBaseQuotedPrice !== null
      ? proposal.couponBaseQuotedPrice
      : proposal.quotedPrice;
  const extraPrice = Math.max(0, effectiveQuotedPrice - SALES_PROPOSAL_BASE_PRICE);

  if (extraCredits === 0 && extraPrice === 0) {
    return 0;
  }

  const creditCount = extraCredits / option.credits;
  const priceCount = extraPrice / option.price;
  const roundedCreditCount = Number.isInteger(creditCount) ? creditCount : null;
  const roundedPriceCount = Number.isInteger(priceCount) ? priceCount : null;

  if (
    roundedCreditCount !== null &&
    roundedPriceCount !== null &&
    roundedCreditCount === roundedPriceCount
  ) {
    return Math.max(0, roundedCreditCount);
  }

  return 0;
}

function getInitiativeDurationDays(initiative: SalesProposalInitiativeDraft) {
  if (initiative.estStartDate && initiative.estEndDate) {
    const start = parseCalendarDate(initiative.estStartDate);
    const end = parseCalendarDate(initiative.estEndDate);
    return Math.max(diffCalendarDays(start, end) + 1, 1);
  }

  return getSuggestedInitiativeDurationDays(initiative);
}

function alignInitiativesToProposalStartDate(
  initiatives: SalesProposalInitiativeDraft[],
  proposalStartDate: string,
) {
  const nextInitiatives = initiatives.map((initiative) => createEditorDraft(initiative));
  const kickoffTitle = normalizeCatalogText("SesiÃ³n Kickoff");
  const kickoff = nextInitiatives.find(
    (initiative) => normalizeCatalogText(initiative.title) === kickoffTitle,
  ) ?? nextInitiatives.find((initiative) => isKickoffInitiative(initiative));

  if (!kickoff || !proposalStartDate) {
    return nextInitiatives;
  }

  const kickoffDuration = getInitiativeDurationDays(kickoff);
  kickoff.estStartDate = proposalStartDate;
  kickoff.estEndDate = toIsoDate(
    addCalendarDays(parseCalendarDate(proposalStartDate), kickoffDuration - 1),
  );

  let cursorDate = addCalendarDays(parseCalendarDate(kickoff.estEndDate), 1);
  const statusPriority: Record<InitiativeStatus, number> = {
    executing: 0,
    planned: 1,
    completed: 2,
    backlog: 3,
  };

  nextInitiatives
    .filter((initiative) => initiative.status === "backlog")
    .forEach((initiative) => {
      initiative.estStartDate = "";
      initiative.estEndDate = "";
    });

  nextInitiatives
    .filter((initiative) => initiative.id !== kickoff.id && initiative.status !== "backlog")
    .sort((left, right) => {
      const priorityDelta = statusPriority[left.status] - statusPriority[right.status];
      if (priorityDelta !== 0) return priorityDelta;
      return left.sortOrder - right.sortOrder;
    })
    .forEach((initiative) => {
      const durationDays = getInitiativeDurationDays(initiative);
      initiative.estStartDate = toIsoDate(cursorDate);
      initiative.estEndDate = toIsoDate(addCalendarDays(cursorDate, durationDays - 1));
      cursorDate = addCalendarDays(cursorDate, durationDays);
    });

  return nextInitiatives;
}

function scheduleRecommendedInitiatives(
  initiatives: SalesProposalInitiativeDraft[],
  targetInitiativeIds: string[],
  proposalStartDate: string,
  options?: { preserveBacklogDates?: boolean; autoFillBacklogDates?: boolean },
) {
  const nextInitiatives = initiatives.map((initiative) => createEditorDraft(initiative));
  const targetIds = new Set(targetInitiativeIds);
  const preserveBacklogDates = options?.preserveBacklogDates ?? false;
  const autoFillBacklogDates = options?.autoFillBacklogDates ?? false;
  const kickoffTitle = normalizeCatalogText("Sesión Kickoff");
  const kickoff = nextInitiatives.find(
    (initiative) => normalizeCatalogText(initiative.title) === kickoffTitle,
  ) ?? nextInitiatives.find((initiative) => isKickoffInitiative(initiative));

  if (!kickoff) {
    return nextInitiatives;
  }

  const kickoffStartDate = kickoff.estStartDate || proposalStartDate || toIsoDate();
  const kickoffCurrentEnd = kickoff.estEndDate || kickoffStartDate;
  const kickoffStart = parseCalendarDate(kickoffStartDate);
  const kickoffEnd = parseCalendarDate(kickoffCurrentEnd);

  kickoff.estStartDate = kickoffStartDate;
  kickoff.estEndDate =
    kickoffEnd <= kickoffStart
      ? toIsoDate(addCalendarDays(kickoffStart, 5))
      : kickoffCurrentEnd;

  let cursorDate = addCalendarDays(parseCalendarDate(kickoff.estEndDate), 1);
  const statusPriority: Record<InitiativeStatus, number> = {
    executing: 0,
    planned: 1,
    backlog: 2,
    completed: 3,
  };

  nextInitiatives
    .filter((initiative) => targetIds.has(initiative.id) && initiative.status === "backlog")
    .forEach((initiative) => {
      if (preserveBacklogDates) {
        if (!initiative.estStartDate) {
          if (initiative.estEndDate) {
            initiative.estStartDate = initiative.estEndDate;
            return;
          }

          if (!autoFillBacklogDates) {
            return;
          }

          const durationDays = getSuggestedInitiativeDurationDays(initiative);
          initiative.estStartDate = toIsoDate(cursorDate);
          initiative.estEndDate = toIsoDate(addCalendarDays(cursorDate, durationDays - 1));
          cursorDate = addCalendarDays(cursorDate, durationDays);
          return;
        }

        if (!initiative.estEndDate) {
          const durationDays = getSuggestedInitiativeDurationDays(initiative);
          initiative.estEndDate = toIsoDate(
            addCalendarDays(parseCalendarDate(initiative.estStartDate), durationDays - 1),
          );
        }
        return;
      }

      initiative.estStartDate = "";
      initiative.estEndDate = "";
    });

  nextInitiatives
    .filter(
      (initiative) =>
        targetIds.has(initiative.id) &&
        initiative.id !== kickoff.id &&
        initiative.status !== "backlog" &&
        (!initiative.estStartDate || !initiative.estEndDate),
    )
    .sort((left, right) => {
      const priorityDelta = statusPriority[left.status] - statusPriority[right.status];
      if (priorityDelta !== 0) return priorityDelta;
      return left.sortOrder - right.sortOrder;
    })
    .forEach((initiative) => {
      const durationDays = getSuggestedInitiativeDurationDays(initiative);
      initiative.estStartDate = toIsoDate(cursorDate);
      initiative.estEndDate = toIsoDate(addCalendarDays(cursorDate, durationDays - 1));
      cursorDate = addCalendarDays(cursorDate, durationDays);
    });

  return nextInitiatives;
}

export function SalesProposalWorkspace({
  initialCatalog,
  initialGroups,
  initialGroupCategories,
  initialGroupCategoryLinks,
  initialGroupMemberships,
  initialProposal,
  variant = "hubspot",
  routeBase = "/sales/proposals",
  sellerPreset = null,
  canWaiveAnyInitiative = false,
}: SalesProposalWorkspaceProps) {
  const wizardChallenges: Record<
    string,
    Array<{ id: string; label: string; description: string; keywords: string[] }>
  > = {};
  const isDinterwebVariant = variant === "dinterweb";
  const stageSchedulingOptions = isDinterwebVariant
    ? { preserveBacklogDates: true, autoFillBacklogDates: true }
    : { preserveBacklogDates: true, autoFillBacklogDates: false };
  const newProposalHref = `${routeBase}/new`;
  const workspaceHomeHref = isDinterwebVariant ? "/sales/dinterweb" : newProposalHref;
  const packageOptions = SALES_PROPOSAL_UPSELL_OPTIONS;

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialDraft = useMemo(
    () =>
      normalizeSalesProposalDraft({
        ...(initialProposal ?? createNewSalesProposalDraft(variant, sellerPreset)),
        workspaceVariant: variant,
      }),
    [initialProposal, sellerPreset, variant],
  );
  const [proposal, setProposal] = useState<SalesProposalDraft>(initialDraft);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const [isActivating, setIsActivating] = useState(false);
  const [isSyncingPayment, setIsSyncingPayment] = useState(false);
  const [isGeneratingWizardPlan, setIsGeneratingWizardPlan] = useState(false);
  const [wizardLoadingMessageIndex, setWizardLoadingMessageIndex] = useState(0);
  const [isUpsellModalOpen, setIsUpsellModalOpen] = useState(false);
  const [upsellPackageCredits, setUpsellPackageCredits] = useState<number>(
    packageOptions[0].credits,
  );
  const [upsellCartCount, setUpsellCartCount] = useState(0);
  const [dinterwebPlanCreditsDraft, setDinterwebPlanCreditsDraft] = useState(
    String(Math.max(DINTERWEB_MIN_PACKAGE.credits, getDinterwebMonthlyCredits(initialDraft))),
  );
  const [dinterwebPlanPriceDraft, setDinterwebPlanPriceDraft] = useState(
    String(Math.max(DINTERWEB_MIN_PACKAGE.price, getDinterwebMonthlyPrice(initialDraft))),
  );
  const [dinterwebPackageCreditsStep, setDinterwebPackageCreditsStep] = useState(() =>
    inferDinterwebPackageCreditsStep(getDinterwebMonthlyCredits(initialDraft)),
  );
  const [dinterwebPackagePriceStep, setDinterwebPackagePriceStep] = useState(() =>
    inferDinterwebPackagePriceStep(
      getDinterwebMonthlyCredits(initialDraft),
      getDinterwebMonthlyPrice(initialDraft),
    ),
  );
  const [isCouponPanelOpen, setIsCouponPanelOpen] = useState(
    Boolean(initialProposal?.appliedCouponCode?.trim()),
  );
  const [couponCode, setCouponCode] = useState(initialProposal?.appliedCouponCode ?? "");
  const [isApplyingCoupon, setIsApplyingCoupon] = useState(false);
  const [isRemovingCoupon, setIsRemovingCoupon] = useState(false);
  const [isCatalogModalOpen, setIsCatalogModalOpen] = useState(false);
  const [activeCatalogTab, setActiveCatalogTab] = useState<string>("wizard");
  const [catalogPreviewGroup, setCatalogPreviewGroup] = useState<CatalogModalGroup | null>(null);
  const [catalogSearchQuery, setCatalogSearchQuery] = useState("");
  const [catalogTagFilter, setCatalogTagFilter] = useState<string | null>(null);
  const [wizardHubs, setWizardHubs] = useState<string[]>([]);
  const [wizardPortalState, setWizardPortalState] = useState<"new" | "optimize">("new");
  const [wizardChallenge, setWizardChallenge] = useState<string>("");
  const [wizardContext, setWizardContext] = useState("");
  const [editingInitiativeId, setEditingInitiativeId] = useState<string | null>(null);
  const [initiativeDraft, setInitiativeDraft] = useState<SalesProposalInitiativeDraft | null>(null);
  const [quickAddSelections, setQuickAddSelections] = useState<Record<InitiativeStatus, string>>({
    backlog: "",
    planned: "",
    executing: "",
    completed: "",
  });
  const [draggedInitiativeId, setDraggedInitiativeId] = useState<string | null>(null);
  const [dropTargetStatus, setDropTargetStatus] = useState<InitiativeStatus | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{
    status: InitiativeStatus;
    initiativeId: string | null;
    position: DropPosition;
  } | null>(null);
  const [ganttDrag, setGanttDrag] = useState<{
    initiativeId: string;
    originX: number;
    dayDelta: number;
    startDate: string;
    endDate: string;
    mode: "move" | "resize-start" | "resize-end";
  } | null>(null);
  const [isSavingTimelineDates, setIsSavingTimelineDates] = useState(false);
  const [isExportingReport, setIsExportingReport] = useState(false);
  const proposalSaveChainRef = useRef<Promise<SalesProposalDraft | null>>(Promise.resolve(null));
  const lastPersistedSignatureRef = useRef(getSalesProposalAutosaveSignature(initialDraft));
  const pendingProposalSlugRef = useRef<string | null>(initialDraft.slug ?? null);
  const persistProposalRef = useRef<((draftOverride?: SalesProposalDraft, options?: { mergeWithCurrent?: boolean }) => Promise<SalesProposalDraft>) | null>(null);
  const catalogContentRef = useRef<HTMLDivElement | null>(null);

  function applyDinterwebCommercialTerms(
    monthlyCredits: number,
    monthlyPrice: number,
    billingMode: SalesProposalDraft["billingMode"],
    periodMonths: SalesProposalDraft["periodMonths"],
  ) {
    const normalizedMonthlyCredits = Math.max(DINTERWEB_MIN_PACKAGE.credits, safeParseNumber(monthlyCredits));
    const normalizedMonthlyPrice = Math.max(DINTERWEB_MIN_PACKAGE.price, safeParseNumber(monthlyPrice));
    const multiplier = getDinterwebChargeMultiplier(billingMode, periodMonths);

    setProposal((current) => {
      const nextCreditValidityDays =
        current.billingMode === billingMode
          ? current.creditValidityDays
          : getDefaultSalesCreditValidityDays(billingMode);

      return applyActiveCouponPricing({
        ...clearProspectExtraPackages(current),
        workspaceVariant: "dinterweb",
        billingMode,
        periodMonths,
        creditValidityDays: nextCreditValidityDays,
        contractedCredits: normalizedMonthlyCredits * multiplier,
        quotedPrice: normalizedMonthlyPrice * multiplier,
      });
    });
  }

  const catalogOptions = useMemo(() => {
    const grouped = new Map<string, CreditCatalogItem[]>();

    initialCatalog.forEach((item) => {
      const bucket = grouped.get(item.category) ?? [];
      bucket.push(item);
      grouped.set(item.category, bucket);
    });

    return Array.from(grouped.entries());
  }, [initialCatalog]);

  const catalogGroups = useMemo(() => {
    return buildCatalogModalGroups({
      groups: initialGroups,
      categories: initialGroupCategories,
      categoryLinks: initialGroupCategoryLinks,
      memberships: initialGroupMemberships,
      items: initialCatalog,
    });
  }, [initialCatalog, initialGroupCategories, initialGroupCategoryLinks, initialGroups, initialGroupMemberships]);

  const catalogGroupOptions = useMemo(() => {
    return buildCatalogGroupOptions(catalogGroups, initialGroupCategories);
  }, [catalogGroups, initialGroupCategories]);

  const catalogTabs = useMemo(
    () => [
      { id: "wizard", label: "Guía de Activación" },
      ...catalogGroupOptions.map((category) => ({ id: category.id, label: category.label })),
    ].filter((tab) => SHOW_CATALOG_WIZARD_TAB || tab.id !== "wizard"),
    [catalogGroupOptions],
  );

  const activeCatalogCategory = useMemo(
    () => catalogGroupOptions.find((category) => category.id === activeCatalogTab) ?? null,
    [activeCatalogTab, catalogGroupOptions],
  );

  const isGlobalCatalogSearch = catalogSearchQuery.trim().length > 0;

  const visibleCatalogGroups = useMemo(() => {
    const sourceGroups = (isGlobalCatalogSearch || catalogTagFilter)
      ? Array.from(
        new Map(catalogGroupOptions.flatMap((category) => category.groups).map((group) => [group.id, group])).values(),
      )
      : (activeCatalogCategory?.groups ?? []);

    return sourceGroups.filter(
      (group) =>
        matchesCatalogGroupSearch(group, catalogSearchQuery) &&
        (!catalogTagFilter || group.tags.includes(catalogTagFilter)),
    );
  }, [activeCatalogCategory, catalogGroupOptions, catalogSearchQuery, catalogTagFilter, isGlobalCatalogSearch]);

  useEffect(() => {
    if (!isCatalogModalOpen) return;

    setCatalogSearchQuery("");
    setCatalogTagFilter(null);

    const node = catalogContentRef.current;
    if (!node) return;

    node.scrollTo({ top: 0, behavior: "auto" });
  }, [activeCatalogTab, isCatalogModalOpen]);

  const wizardOptionLabels = useMemo(() => {
    return [...WIZARD_HUB_OPTIONS];
  }, []);

  const groupedInitiatives = useMemo(
    () =>
      boardStatuses.reduce(
        (accumulator, status) => {
          accumulator[status] = proposal.initiatives
            .filter((initiative) => initiative.status === status)
            .sort((left, right) => left.sortOrder - right.sortOrder);
          return accumulator;
        },
        {} as Record<InitiativeStatus, SalesProposalInitiativeDraft[]>,
      ),
    [proposal.initiatives],
  );

  const metrics = useMemo(() => calculateSalesProposalMetrics(proposal), [proposal]);
  const reportGroupedInitiatives = useMemo(
    () =>
      summaryStatuses.reduce(
        (accumulator, status) => {
          accumulator[status] = groupedInitiatives[status].map<PlanReportInitiative>((initiative) => ({
            id: initiative.id,
            title: initiative.title,
            description: getPlainInitiativeDescription(initiative.description, ""),
            credits: calculateSalesInitiativeCredits(initiative),
            status: initiative.status,
            dateRange: formatDateRange(initiative.estStartDate || null, initiative.estEndDate || null),
            isBlocked: initiative.isBlocked,
            subitems: initiative.subitems.map((subitem) => ({
              id: subitem.id,
              name: subitem.name,
              quantity: subitem.quantity,
              unitCredits: initiative.commerciallyWaived ? 0 : subitem.unitCredits,
              statusLabel: TASK_STATUS_META[subitem.status]?.label,
            })),
          }));
          return accumulator;
        },
        {} as Record<InitiativeStatus, PlanReportInitiative[]>,
      ),
    [groupedInitiatives],
  );

  const timelineRows = useMemo(() => {
    const today = new Date();
    const windowStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const minimumWindowEnd = addCalendarDays(addRollingCalendarMonths(windowStart, 3), 1);

    const datedRows = proposal.initiatives
      .map((initiative) => {
        const start = initiative.estStartDate ? parseCalendarDate(initiative.estStartDate) : null;
        const end = initiative.estEndDate ? parseCalendarDate(initiative.estEndDate) : null;

        return { initiative, start, end };
      })
      .sort((left, right) => {
        if (!left.start) return 1;
        if (!right.start) return -1;
        return left.start.getTime() - right.start.getTime();
      });

    const latestScheduledEnd = datedRows.reduce<Date | null>((latest, row) => {
      if (!row.end) return latest;
      if (!latest || row.end > latest) return row.end;
      return latest;
    }, null);
    const windowEnd =
      latestScheduledEnd && latestScheduledEnd >= minimumWindowEnd
        ? addCalendarDays(addRollingCalendarMonths(latestScheduledEnd, 1), 1)
        : minimumWindowEnd;

    const timelineDays = Math.max(diffCalendarDays(windowStart, windowEnd), 1);
    const monthSegments = buildRollingTimelineMonthSegments(windowStart, windowEnd);

    const dayMarkers = Array.from({ length: timelineDays }, (_, index) => {
      const date = addCalendarDays(windowStart, index);
      const isMonthStart = date.getDate() === 1;
      const isWeeklyMarker = index === 0 || index % 7 === 0;

      return {
        key: date.toISOString(),
        date,
        label: new Intl.DateTimeFormat("es-NI", { day: "numeric" }).format(date),
        showLabel: isMonthStart || isWeeklyMarker,
      };
    });

    const todayOffset = diffCalendarDays(windowStart, today);
    const visibleRows = datedRows
      .filter((row) => row.start && row.end)
      .map((row) => {
        const start = row.start as Date;
        const end = row.end as Date;
        const clampedStart = start < windowStart ? windowStart : start;
        const clampedEnd = end >= windowEnd ? addCalendarDays(windowEnd, -1) : end;
        const startOffset = Math.max(diffCalendarDays(windowStart, clampedStart), 0);
        const endOffset = Math.min(diffCalendarDays(windowStart, clampedEnd) + 1, timelineDays);
        const span = Math.max(endOffset - startOffset, 1);

        return {
          ...row,
          startOffset,
          span,
          isOutsideRange: end < windowStart || start >= windowEnd,
          rangeLabel: formatDateRange(row.initiative.estStartDate, row.initiative.estEndDate),
        };
      });

    return {
      dayWidth: 16,
      monthSegments,
      dayMarkers,
      timelineDays,
      todayOffset,
      rows: visibleRows,
      undatedRows: datedRows.filter((row) => !row.start || !row.end).map((row) => row.initiative),
      windowStart,
      windowEnd,
    };
  }, [proposal.initiatives]);

  useEffect(() => {
    if (!isGeneratingWizardPlan) {
      setWizardLoadingMessageIndex(0);
      return;
    }

    const intervalId = window.setInterval(() => {
      setWizardLoadingMessageIndex((current) =>
        current < WIZARD_LOADING_MESSAGES.length - 1 ? current + 1 : current,
      );
    }, 1800);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isGeneratingWizardPlan]);

  function openInitiativeEditor(initiative: SalesProposalInitiativeDraft) {
    setEditingInitiativeId(initiative.id);
    setInitiativeDraft(createEditorDraft(initiative));
  }

  function createDraftInitiative(status: InitiativeStatus) {
    const next = createEmptySalesInitiative(status);
    next.id = createLocalId("sales-initiative");
    next.sortOrder = groupedInitiatives[status].length;
    return next;
  }

  function openGroupedDraft(status: InitiativeStatus) {
    const selectedCatalogId = quickAddSelections[status];
    const selectedItem = initialCatalog.find((item) => item.id === selectedCatalogId);
    const next = createDraftInitiative(status);

    if (selectedItem) {
      next.title = selectedItem.label;
      next.type = selectedItem.category;
      next.subitems = [createProposalSubitemFromCatalog(selectedItem)];
    }

    setEditingInitiativeId(null);
    setInitiativeDraft(next);
  }

  function quickAddInitiative(status: InitiativeStatus) {
    const selectedCatalogId = quickAddSelections[status];
    const selectedItem = initialCatalog.find((item) => item.id === selectedCatalogId);

    if (!selectedItem) {
      setFeedback({ tone: "error", message: "Selecciona un caso del catalogo para anadir." });
      return;
    }

    const next = createDraftInitiative(status);
    next.title = selectedItem.label;
    next.type = selectedItem.category;
    next.description = `Caso de uso agregado desde ${selectedItem.category}.`;
    next.subitems = [createProposalSubitemFromCatalog(selectedItem)];

    setProposal((current) => {
      const scheduledInitiatives = scheduleRecommendedInitiatives(
        [...current.initiatives, next],
        [next.id],
        current.startDate,
        stageSchedulingOptions,
      );

      return {
        ...current,
        initiatives: normalizeBoardSortOrders(scheduledInitiatives),
      };
    });
    setQuickAddSelections((current) => ({ ...current, [status]: "" }));
    setFeedback({ tone: "success", message: "Caso de uso agregado a la propuesta." });
  }

  function renderDinterwebStageComposer(status: InitiativeStatus) {
    if (!isDinterwebVariant || !canManageSalesStage(status)) {
      return null;
    }

    return (
      <div className="space-y-2">
        <div className="rounded-[4px] border border-dashed border-[#cbd6e2] bg-white p-1.5 shadow-sm">
          <select
            value={quickAddSelections[status]}
            onChange={(event) =>
              setQuickAddSelections((current) => ({
                ...current,
                [status]: event.target.value,
              }))
            }
            className="h-10 w-full rounded-[3px] border border-transparent bg-white px-3 text-[10px] font-medium leading-4 text-[#33475b] outline-none transition focus:border-[#00bda5]"
          >
            <option value="">-- Rapido --</option>
            {catalogOptions.map(([category, items]) => (
              <optgroup key={`quick-${status}-${category}`} label={category}>
                {items.map((item) => (
                  <option key={`quick-${status}-${item.id}`} value={item.id}>
                    {item.label} ({item.credits} CR)
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <div className="mt-1.5 flex gap-1.5">
            <button
              type="button"
              onClick={() => quickAddInitiative(status)}
              disabled={!quickAddSelections[status]}
              className="inline-flex h-7 flex-1 items-center justify-center rounded-[3px] border border-[#cbd6e2] bg-white px-2 py-1 text-[10px] font-bold text-[#516f90] transition hover:border-[#8fb3d9] hover:bg-[#f8fbff] hover:text-[#33475b] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Anadir
            </button>
            <button
              type="button"
              onClick={() => openGroupedDraft(status)}
              className="inline-flex h-7 items-center justify-center rounded-[3px] border border-[#cbd6e2] bg-white px-2 py-1 text-[10px] font-bold text-[#516f90] transition hover:border-[#8fb3d9] hover:bg-[#f8fbff] hover:text-[#33475b]"
            >
              Agrupar
            </button>
          </div>
        </div>
      </div>
    );
  }

  function closeInitiativeEditor() {
    setEditingInitiativeId(null);
    setInitiativeDraft(null);
  }

  function moveInitiativeToStatus(
    initiative: SalesProposalInitiativeDraft,
    targetStatus: InitiativeStatus,
    options?: {
      targetInitiativeId?: string | null;
      position?: DropPosition;
    },
  ) {
    const reorderResult = reorderBoardItems({
      items: proposal.initiatives,
      draggedId: initiative.id,
      targetStatus,
      targetId: options?.targetInitiativeId,
      position: options?.position,
      getId: (item) => item.id,
      getStatus: (item) => item.status,
      getSortOrder: (item) => item.sortOrder,
      updateItem: (item, patch) => ({
        ...item,
        status: patch.status,
        sortOrder: patch.sortOrder,
      }),
    });

    if (!reorderResult) {
      setDraggedInitiativeId(null);
      setDropTargetStatus(null);
      setDropIndicator(null);
      return;
    }

    const statusChanged = reorderResult.statusChanged;

    if (
      statusChanged &&
      !canMoveSalesInitiativeToStatus(initiative.status, targetStatus)
    ) {
      setFeedback({
        tone: "error",
        message:
          "En la vista comercial solo puedes mover casos de uso entre En evaluacion y Planificado.",
      });
      setDraggedInitiativeId(null);
      setDropTargetStatus(null);
      setDropIndicator(null);
      return;
    }

    setProposal((current) => {
      const scheduledInitiatives = scheduleRecommendedInitiatives(
        reorderResult.items,
        [initiative.id],
        current.startDate,
        stageSchedulingOptions,
      );

      return {
        ...current,
        initiatives: normalizeBoardSortOrders(scheduledInitiatives),
      };
    });

    if (statusChanged) {
      setFeedback({
        tone: "success",
        message: `Caso de uso movido a ${STATUS_META[targetStatus].label}.`,
      });
    } else {
      setFeedback(null);
    }
    setDraggedInitiativeId(null);
    setDropTargetStatus(null);
    setDropIndicator(null);
  }

  function updateEvaluationValidationStatus(
    initiativeId: string,
    status: SalesProposalInitiativeDraft["validationStatus"],
  ) {
    setProposal((current) => ({
      ...current,
      initiatives: current.initiatives.map((initiative) =>
        initiative.id === initiativeId
          ? {
              ...initiative,
              validationStatus: initiative.validationStatus === status ? null : status,
            }
          : initiative,
      ),
    }));
  }

  function toggleInitiativeDraftCommercialWaiver() {
    const canChangeWaiverAtCurrentProposalStage =
      proposal.status === "draft" || canWaiveAnyInitiative;

    if (
      !initiativeDraft ||
      !canChangeWaiverAtCurrentProposalStage ||
      !canToggleCommercialWaiver(initiativeDraft, canWaiveAnyInitiative)
    ) {
      return;
    }

    setInitiativeDraft({
      ...initiativeDraft,
      commerciallyWaived: !initiativeDraft.commerciallyWaived,
    });
  }

  async function saveInitiativeDraft() {
    if (!initiativeDraft) return;

    if (!initiativeDraft.title.trim()) {
      setFeedback({ tone: "error", message: "Agrega un titulo para la iniciativa." });
      return;
    }

    if (!initiativeDraft.subitems.length) {
      setFeedback({ tone: "error", message: "Agrega al menos una actividad al plan." });
      return;
    }

    const existingInitiative = proposal.initiatives.find(
      (initiative) => initiative.id === initiativeDraft.id,
    );

    if (
      existingInitiative &&
      existingInitiative.status !== initiativeDraft.status &&
      !canMoveSalesInitiativeToStatus(existingInitiative.status, initiativeDraft.status)
    ) {
      setFeedback({
        tone: "error",
        message:
          "En la vista comercial solo puedes mover casos de uso entre En evaluacion y Planificado.",
      });
      return;
    }

    const exists = proposal.initiatives.some((initiative) => initiative.id === initiativeDraft.id);
    const nextInitiatives = exists
      ? proposal.initiatives.map((initiative) =>
          initiative.id === initiativeDraft.id ? createEditorDraft(initiativeDraft) : initiative,
        )
      : [...proposal.initiatives, createEditorDraft(initiativeDraft)];

    const scheduledInitiatives = scheduleRecommendedInitiatives(
      nextInitiatives,
      [initiativeDraft.id],
      proposal.startDate,
      stageSchedulingOptions,
    );
    const nextProposal = {
      ...proposal,
      initiatives: normalizeBoardSortOrders(scheduledInitiatives),
    };
    const commercialWaiverChanged =
      existingInitiative !== undefined &&
      existingInitiative.commerciallyWaived !== initiativeDraft.commerciallyWaived;

    setProposal(nextProposal);
    closeInitiativeEditor();

    if (commercialWaiverChanged && proposal.status !== "draft" && canWaiveAnyInitiative) {
      try {
        await persistProposal(nextProposal, { mergeWithCurrent: true });
        setFeedback({
          tone: "success",
          message: initiativeDraft.commerciallyWaived
            ? "Caso de uso bonificado correctamente."
            : "Bonificacion retirada correctamente.",
        });
      } catch (caughtError) {
        setProposal(proposal);
        setFeedback({
          tone: "error",
          message: formatUserError(caughtError, "No pudimos actualizar la bonificacion."),
        });
      }
      return;
    }

    setFeedback({ tone: "success", message: "Iniciativa actualizada en la propuesta." });
  }

  function removeInitiative(initiativeId: string) {
    setProposal((current) => ({
      ...current,
      initiatives: current.initiatives.filter((initiative) => initiative.id !== initiativeId),
    }));
    if (editingInitiativeId === initiativeId) {
      closeInitiativeEditor();
    }
  }

  function openCatalogModal(tab?: string) {
    const nextTab = tab ?? defaultCatalogLibraryTab;
    setActiveCatalogTab(nextTab);
    setCatalogSearchQuery("");
    setIsCatalogModalOpen(true);
  }

  function closeCatalogModal() {
    setIsCatalogModalOpen(false);
    setCatalogPreviewGroup(null);
    setCatalogSearchQuery("");
  }

  function openUpsellModal() {
    if (proposal.appliedCouponCode.trim()) {
      setFeedback({
        tone: "error",
        message: isDinterwebVariant
          ? "Quita o cambia el cupon antes de reconfigurar el paquete."
          : "Quita o cambia el cupon antes de agregar creditos extra al plan.",
      });
      return;
    }

    if (isDinterwebVariant) {
      setDinterwebPlanCreditsDraft(
        String(Math.max(DINTERWEB_MIN_PACKAGE.credits, getDinterwebMonthlyCredits(proposal))),
      );
      setDinterwebPlanPriceDraft(
        String(Math.max(DINTERWEB_MIN_PACKAGE.price, getDinterwebMonthlyPrice(proposal))),
      );
      setIsUpsellModalOpen(true);
      return;
    }

    const defaultPackageOption = packageOptions[0];
    setUpsellPackageCredits(defaultPackageOption.credits);
    setUpsellCartCount(getCurrentHubspotUpsellCount(proposal, defaultPackageOption));
    setIsUpsellModalOpen(true);
  }

  function closeUpsellModal() {
    setIsUpsellModalOpen(false);
  }

  function adjustDinterwebPackage(direction: 1 | -1) {
    if (hasAppliedCoupon) {
      setFeedback({
        tone: "error",
        message: "Quita o cambia el cupon antes de reconfigurar el paquete.",
      });
      return;
    }

    if (isProposalCheckoutLocked) {
      return;
    }

    const currentMonthlyCredits = Math.max(DINTERWEB_MIN_PACKAGE.credits, dinterwebMonthlyCredits);
    const currentMonthlyPrice = Math.max(DINTERWEB_MIN_PACKAGE.price, dinterwebMonthlyPrice);
    const nextMonthlyCredits = Math.max(
      dinterwebPackageCreditsStep,
      currentMonthlyCredits + dinterwebPackageCreditsStep * direction,
    );
    const nextMonthlyPrice = Math.max(
      dinterwebPackagePriceStep,
      currentMonthlyPrice + dinterwebPackagePriceStep * direction,
    );

    applyDinterwebCommercialTerms(
      nextMonthlyCredits,
      nextMonthlyPrice,
      proposal.billingMode,
      proposal.periodMonths,
    );
    setDinterwebPlanCreditsDraft(String(nextMonthlyCredits));
    setDinterwebPlanPriceDraft(String(nextMonthlyPrice));
    setFeedback({
      tone: "success",
      message: `Capacidad configurada en ${nextMonthlyCredits} creditos por periodo.`,
    });
  }

  function adjustHubspotPackage(direction: 1 | -1) {
    if (hasAppliedCoupon) {
      setFeedback({
        tone: "error",
        message: "Quita o cambia el cupon antes de reconfigurar el paquete.",
      });
      return;
    }

    if (isProposalCheckoutLocked) {
      return;
    }

    const packageOption = packageOptions[0];
    const nextPackageCount = Math.max(0, hubspotUpsellCount + direction);
    const addedCredits = packageOption.credits * nextPackageCount;
    const addedPrice = packageOption.price * nextPackageCount;

    setUpsellPackageCredits(packageOption.credits);
    setUpsellCartCount(nextPackageCount);
    setProposal((current) =>
      applyActiveCouponPricing({
        ...clearProspectExtraPackages(current),
        contractedCredits: SALES_PROPOSAL_BASE_CREDITS + addedCredits,
        quotedPrice: SALES_PROPOSAL_BASE_PRICE + addedPrice,
      }),
    );
    setFeedback({
      tone: "success",
      message: nextPackageCount
        ? `Capacidad configurada en ${SALES_PROPOSAL_BASE_CREDITS + addedCredits} creditos.`
        : "El plan volvio al paquete base sin creditos adicionales.",
    });
  }

  function addUpsellPackage() {
    setUpsellCartCount((current) => current + 1);
  }

  function removeUpsellPackage() {
    setUpsellCartCount((current) => Math.max(0, current - 1));
  }

  function removeHubspotUpsell() {
    setProposal((current) =>
      applyActiveCouponPricing({
        ...clearProspectExtraPackages(current),
        contractedCredits: SALES_PROPOSAL_BASE_CREDITS,
        quotedPrice: SALES_PROPOSAL_BASE_PRICE,
      }),
    );
    setUpsellCartCount(0);
    setFeedback({
      tone: "success",
      message: "El paquete adicional fue eliminado y el plan volvio a la base.",
    });
    closeUpsellModal();
  }

  function removeDinterwebCustomPackage() {
    applyDinterwebCommercialTerms(
      DINTERWEB_DEFAULT_PACKAGE.credits,
      DINTERWEB_DEFAULT_PACKAGE.price,
      proposal.billingMode,
      proposal.periodMonths,
    );
    setDinterwebPlanCreditsDraft(String(DINTERWEB_DEFAULT_PACKAGE.credits));
    setDinterwebPlanPriceDraft(String(DINTERWEB_DEFAULT_PACKAGE.price));
    setDinterwebPackageCreditsStep(DINTERWEB_DEFAULT_PACKAGE.credits);
    setDinterwebPackagePriceStep(DINTERWEB_DEFAULT_PACKAGE.price);
    setFeedback({
      tone: "success",
      message: "El paquete volvio a la base de 80 creditos.",
    });
    closeUpsellModal();
  }

  function confirmUpsell() {
    if (isDinterwebVariant) {
      const nextMonthlyCredits = Math.max(
        DINTERWEB_MIN_PACKAGE.credits,
        safeParseNumber(dinterwebPlanCreditsDraft),
      );
      const nextMonthlyPrice = Math.max(
        DINTERWEB_MIN_PACKAGE.price,
        safeParseNumber(dinterwebPlanPriceDraft),
      );

      if (!nextMonthlyCredits || !nextMonthlyPrice) {
        setFeedback({
          tone: "error",
          message: "Define un paquete valido con creditos e inversion mayores a cero.",
        });
        return;
      }

      if (
        nextMonthlyCredits < DINTERWEB_MIN_PACKAGE.credits ||
        nextMonthlyPrice < DINTERWEB_MIN_PACKAGE.price
      ) {
        setFeedback({
          tone: "error",
          message: `El plan no puede bajar de ${DINTERWEB_MIN_PACKAGE.credits} creditos ni de ${formatCurrency(DINTERWEB_MIN_PACKAGE.price, proposal.currency.toUpperCase())}.`,
        });
        return;
      }

      applyDinterwebCommercialTerms(
        nextMonthlyCredits,
        nextMonthlyPrice,
        proposal.billingMode,
        proposal.periodMonths,
      );
      setDinterwebPackageCreditsStep(nextMonthlyCredits);
      setDinterwebPackagePriceStep(nextMonthlyPrice);
      setFeedback({
        tone: "success",
        message: `Plan configurado en ${nextMonthlyCredits} creditos por periodo.`,
      });
      closeUpsellModal();
      return;
    }

    const addedCredits = upsellPackageCredits * upsellCartCount;
    const addedPrice = upsellPackagePrice * upsellCartCount;

    setProposal((current) =>
      applyActiveCouponPricing({
        ...clearProspectExtraPackages(current),
        contractedCredits: SALES_PROPOSAL_BASE_CREDITS + addedCredits,
        quotedPrice: SALES_PROPOSAL_BASE_PRICE + addedPrice,
      }),
    );
    setFeedback({
      tone: "success",
      message: upsellCartCount
        ? `Capacidad actualizada con ${addedCredits} creditos adicionales.`
        : "El plan volvio al paquete base sin creditos adicionales.",
    });
    closeUpsellModal();
  }

function createInitiativeFromGroup(
  group: CatalogModalGroup,
  status: InitiativeStatus,
  sortOrder: number,
  schedule?: { startDate?: string; endDate?: string },
  options?: { preserveProvidedSchedule?: boolean },
) {
  const next = createEmptySalesInitiative(status);
  const preserveProvidedSchedule = options?.preserveProvidedSchedule ?? false;
  next.id = createLocalId("sales-initiative");
  next.title = group.name;
  next.type = group.modalCategory || group.name;
  next.description = getCatalogGroupInitiativeDescription(group);
    next.subitems = group.items.length
      ? group.items.map((item) => createProposalSubitemFromCatalog(item))
      : [
          {
            id: createLocalId("sales-subitem"),
            catalogItemId: null,
            name: group.name,
            status: "pending",
            targetDate: "",
            unitCredits: Math.max(1, safeParseNumber(group.credits)),
            quantity: 1,
          },
        ];
    if (status === "backlog") {
      next.estStartDate = "";
      next.estEndDate = "";
    } else if (preserveProvidedSchedule) {
      next.estStartDate = schedule?.startDate || "";
      next.estEndDate = schedule?.endDate || "";
    } else {
      next.estStartDate = schedule?.startDate || proposal.startDate;
      next.estEndDate = schedule?.endDate || schedule?.startDate || proposal.startDate;
    }
    next.sortOrder = sortOrder;

    return next;
  }

  function openCatalogGroupPreview(group: CatalogModalGroup) {
    setCatalogPreviewGroup(group);
  }

  function isCatalogGroupAlreadyAdded(group: CatalogModalGroup) {
    const normalizedGroupName = normalizeCatalogText(group.name);

    return proposal.initiatives.some(
      (initiative) =>
        initiative.status !== "completed" &&
        normalizeCatalogText(initiative.title) === normalizedGroupName,
    );
  }

  function closeCatalogGroupPreview() {
    setCatalogPreviewGroup(null);
  }

  function addCatalogPreviewGroup(status: InitiativeStatus) {
    if (!catalogPreviewGroup) return;

    const wasAlreadyAdded = isCatalogGroupAlreadyAdded(catalogPreviewGroup);

    const next = createInitiativeFromGroup(
      catalogPreviewGroup,
      status,
      groupedInitiatives[status].length,
    );

    const scheduledInitiatives = scheduleRecommendedInitiatives(
      [...proposal.initiatives, next],
      [next.id],
      proposal.startDate,
      stageSchedulingOptions,
    );

    const nextProposal = {
      ...proposal,
      initiatives: normalizeBoardSortOrders(scheduledInitiatives),
    };

    const wasPersistQueued = syncProposalAfterStructuralChange(nextProposal);
    setCatalogPreviewGroup(null);
    setFeedback({
      tone: "success",
      message:
        wasAlreadyAdded
          ? "Este caso de uso ya estaba agregado. Sumamos otra instancia a la propuesta."
          : status === "planned"
          ? wasPersistQueued
            ? "Grupo incluido en Planificacion."
            : "Grupo incluido en Planificacion. Se guardara cuando completes el correo del cliente."
          : wasPersistQueued
            ? "Grupo enviado a Evaluacion."
            : "Grupo enviado a Evaluacion. Se guardara cuando completes el correo del cliente.",
    });
  }

  function toggleWizardHub(hub: string) {
    setWizardHubs((current) =>
      current.includes(hub) ? current.filter((value) => value !== hub) : [...current, hub],
    );
  }

  function findCatalogGroupsByCategory(category: string) {
    return (
      catalogGroupOptions.find(
        (entry) =>
          normalizeCatalogText(entry.label) === normalizeCatalogText(category),
      )?.groups ?? []
    );
  }

  function fitRecommendationsToCreditBudget(
    recommendations: WizardRecommendation[],
    creditBudget: number,
  ) {
    const groupsById = new Map(catalogGroups.map((group) => [group.id, group]));
    const existingTitles = new Set(
      proposal.initiatives.map((initiative) => normalizeCatalogText(initiative.title)),
    );
    let usedCredits = 0;

    return recommendations.filter((recommendation) => {
      const group = groupsById.get(recommendation.groupId);
      if (!group) {
        return false;
      }

      if (existingTitles.has(normalizeCatalogText(group.name))) {
        return false;
      }

      const groupCredits = Math.max(0, safeParseNumber(group.credits));
      if (groupCredits === 0) {
        return true;
      }

      if (usedCredits + groupCredits > creditBudget) {
        return false;
      }

      usedCredits += groupCredits;
      return true;
    });
  }

  function syncProposalAfterStructuralChange(nextProposal: SalesProposalDraft) {
    setProposal(nextProposal);

    if (!canPersistSalesProposal(nextProposal)) {
      return false;
    }

    const previousSignature = lastPersistedSignatureRef.current;
    lastPersistedSignatureRef.current = getSalesProposalAutosaveSignature(nextProposal);
    void persistProposalRef.current?.(nextProposal, { mergeWithCurrent: true }).catch(() => {
      lastPersistedSignatureRef.current = previousSignature;
    });

    return true;
  }

function mergeRecommendedGroups(
  recommendations: WizardRecommendation[],
  feedbackMessage: string,
  options?: { preservePromptSchedule?: boolean },
) {
    const preservePromptSchedule = options?.preservePromptSchedule ?? false;
    const existingTitles = new Set(
      proposal.initiatives.map((initiative) => normalizeCatalogText(initiative.title)),
    );
    const nextInitiatives = [...proposal.initiatives];
    const addedInitiativeIds: string[] = [];
    let nextSortOrder = proposal.initiatives.length;
    const groupById = new Map(catalogGroups.map((group) => [group.id, group]));

    const pushInitiativeFromGroup = (
      group: CatalogModalGroup | null,
      recommendation: WizardRecommendation,
    ) => {
      if (!group || existingTitles.has(normalizeCatalogText(group.name))) {
        return;
      }

      const initiative = createInitiativeFromGroup(
        group,
        recommendation.status,
        nextSortOrder,
        {
          startDate: recommendation.startDate,
          endDate: recommendation.endDate,
        },
        { preserveProvidedSchedule: preservePromptSchedule },
      );

      nextSortOrder += 1;
      existingTitles.add(normalizeCatalogText(group.name));
      nextInitiatives.push(initiative);
      addedInitiativeIds.push(initiative.id);
    };

    if (!existingTitles.has(normalizeCatalogText("Sesión Kickoff"))) {
      const kickoff = createDefaultKickoffInitiative(proposal.startDate, nextSortOrder);
      nextSortOrder += 1;
      existingTitles.add(normalizeCatalogText(kickoff.title));
      nextInitiatives.push(kickoff);
      addedInitiativeIds.push(kickoff.id);
    }

    recommendations.forEach((recommendation) => {
      const group = groupById.get(recommendation.groupId) ?? null;
      pushInitiativeFromGroup(group, recommendation);
    });

    const scheduledInitiatives = preservePromptSchedule
      ? nextInitiatives
      : scheduleRecommendedInitiatives(
          nextInitiatives,
          addedInitiativeIds,
          proposal.startDate,
          stageSchedulingOptions,
        );

    const nextProposal = {
      ...proposal,
      initiatives: scheduledInitiatives.map((initiative, index) => ({
        ...initiative,
        sortOrder: index,
      })),
    };

    const wasPersistQueued = syncProposalAfterStructuralChange(nextProposal);
    setActiveCatalogTab(defaultCatalogLibraryTab);
    setIsCatalogModalOpen(false);
    setFeedback({
      tone: "success",
      message: wasPersistQueued
        ? feedbackMessage
        : `${feedbackMessage} Se guardara cuando completes el correo del cliente.`,
    });
  }

  function buildDefaultWizardRecommendations() {
    const recommendations: WizardRecommendation[] = [];

    findCatalogGroupsByCategory("Fundamentales")
      .slice(0, 2)
      .forEach((group) => {
        recommendations.push({
          groupId: group.id,
          status: "planned",
        });
      });

    wizardHubs.forEach((hub, index) => {
      const categoryGroups = findCatalogGroupsByCategory(hub);
      const preferredCount = wizardPortalState === "optimize" ? (index === 0 ? 3 : 2) : 2;

      categoryGroups.slice(0, preferredCount).forEach((group, itemIndex) => {
        recommendations.push({
          groupId: group.id,
          status: index === 0 && itemIndex < 2 ? "planned" : "backlog",
        });
      });
    });

    return recommendations;
  }

  function applyDefaultWizardRecommendations(message = "Plan agregado exitosamente.") {
    const budgetAwareRecommendations = fitRecommendationsToCreditBudget(
      buildDefaultWizardRecommendations(),
      remainingRecommendationCredits,
    );

    mergeRecommendedGroups(
      budgetAwareRecommendations,
      budgetAwareRecommendations.length
        ? message
        : `${message} No agregamos casos adicionales porque superarian los creditos disponibles.`,
    );
  }

  async function applyWizardRecommendations() {
    if (!wizardHubs.length) {
      setFeedback({
        tone: "error",
        message: "Completa la Guia de Activacion antes de generar el plan.",
      });
      return;
    }

    setFeedback(null);
    setIsGeneratingWizardPlan(true);

    try {
      const response = await fetch("/api/sales-proposals/recommend-groups", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workspaceVariant: variant,
          startDate: proposal.startDate,
          selectedHubs: wizardHubs,
          portalState: wizardPortalState,
          context: wizardContext,
          contractedCredits: proposal.contractedCredits,
          currentPlanCredits,
          remainingRecommendationCredits,
          groups: catalogGroups.map((group) => ({
            id: group.id,
            name: group.name,
            description: group.description,
            modalCategory: group.modalCategory,
            priorityStatus: group.priorityStatus,
            credits: group.credits,
            tasks: group.items.map((item) => ({
              id: item.id,
              label: item.label,
              category: item.category,
              credits: item.credits,
            })),
          })),
        }),
      });

      const payload = await parseJsonResponse<WizardRecommendationResponse>(response);

      if (!response.ok) {
        throw new Error(payload.message || "No pudimos generar la recomendacion inteligente.");
      }

      const normalizedRecommendations: WizardRecommendation[] = (payload.recommendations ?? []).flatMap(
        (recommendation) => {
          const normalizedStatus =
            recommendation.status === "executing" ||
            recommendation.status === "planned" ||
            recommendation.status === "backlog"
              ? recommendation.status
              : null;

          return recommendation.group_id && normalizedStatus
              ? [{
                  groupId: recommendation.group_id,
                  status: normalizedStatus,
                  reason: recommendation.reason,
                  startDate: recommendation.start_date,
                  endDate: recommendation.end_date,
                }]
              : [];
        },
      );

      if (!normalizedRecommendations.length) {
        applyDefaultWizardRecommendations(
          "Claude no devolvio grupos validos. Aplicamos la recomendacion base del catalogo.",
        );
        return;
      }

      mergeRecommendedGroups(
        normalizedRecommendations,
        "Plan agregado exitosamente.",
        { preservePromptSchedule: true },
      );
    } catch (caughtError) {
      console.error("sales_wizard_recommendations_failed", caughtError);
      applyDefaultWizardRecommendations(
        `No pudimos consultar Claude. Usamos la recomendacion base. ${formatUserError(caughtError, "")}`.trim(),
      );
    } finally {
      setIsGeneratingWizardPlan(false);
    }
  }

  function updateInitiativeDraft<K extends keyof SalesProposalInitiativeDraft>(
    field: K,
    value: SalesProposalInitiativeDraft[K],
  ) {
    if (!initiativeDraft) return;
    setInitiativeDraft({ ...initiativeDraft, [field]: value });
  }

  function updateDraftSubitem(
    index: number,
    field: keyof SalesProposalInitiativeDraft["subitems"][number],
    value: string | number,
  ) {
    if (!initiativeDraft) return;

    const nextSubitems = [...initiativeDraft.subitems];
    const target = nextSubitems[index];
    if (!target) return;

    if (field === "quantity" || field === "unitCredits") {
      target[field] = Math.max(field === "quantity" ? 1 : 0, safeParseNumber(value));
    } else {
      (target[field] as string | null) = String(value);
    }

    setInitiativeDraft({ ...initiativeDraft, subitems: nextSubitems });
  }

  function addDraftSubitem(catalogItemId: string) {
    if (!initiativeDraft || !catalogItemId) return;
    const item = initialCatalog.find((catalogEntry) => catalogEntry.id === catalogItemId);
    if (!item) return;

    setInitiativeDraft({
      ...initiativeDraft,
      type: initiativeDraft.type || item.category,
      subitems: [...initiativeDraft.subitems, createProposalSubitemFromCatalog(item)],
    });
  }

  function addManualDraftSubitem() {
    if (!initiativeDraft) return;

    setInitiativeDraft({
      ...initiativeDraft,
      subitems: [
        ...initiativeDraft.subitems,
        {
          id: createLocalId("sales-subitem"),
          catalogItemId: null,
          name: "Actividad personalizada",
          status: "pending",
          targetDate: "",
          unitCredits: 1,
          quantity: 1,
        },
      ],
    });
  }

  function removeDraftSubitem(index: number) {
    if (!initiativeDraft) return;
    setInitiativeDraft({
      ...initiativeDraft,
      subitems: initiativeDraft.subitems.filter((_, currentIndex) => currentIndex !== index),
    });
  }

  const persistProposal = useCallback(async (
    draftOverride?: SalesProposalDraft,
    options?: { mergeWithCurrent?: boolean },
  ) => {
    const draftToPersist = normalizeSalesProposalDraft(draftOverride ?? proposal);
    const persistTask = async () => {
      const slug =
        draftToPersist.slug || pendingProposalSlugRef.current || generateSalesProposalSlug(draftToPersist);

      if (!draftToPersist.slug && !pendingProposalSlugRef.current) {
        pendingProposalSlugRef.current = slug;
      }

      const response = await fetch(
        draftToPersist.slug ? `/api/sales-proposals/${draftToPersist.slug}` : "/api/sales-proposals",
        {
          method: draftToPersist.slug ? "PUT" : "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ...draftToPersist, slug }),
        },
      );

      const payload = (await response.json()) as SalesProposalRecord & { message?: string };

      if (!response.ok) {
        throw new Error(payload.message || "No pudimos guardar la propuesta.");
      }

      const normalizedPayload = normalizeSalesProposalDraft(payload);
      const resolvedSlug = normalizedPayload.slug ?? slug;
      pendingProposalSlugRef.current = resolvedSlug;
      lastPersistedSignatureRef.current = getSalesProposalAutosaveSignature(normalizedPayload);

      if (options?.mergeWithCurrent) {
        setProposal((current) => mergePersistedProposalIntoCurrent(current, normalizedPayload));
      } else {
        setProposal(normalizedPayload);
      }

      if (!draftToPersist.slug) {
        router.replace(`${routeBase}/${resolvedSlug}`);
      }

      return normalizedPayload;
    };

    const resultPromise = proposalSaveChainRef.current.then(persistTask, persistTask);
    proposalSaveChainRef.current = resultPromise.then(
      (savedProposal) => savedProposal,
      () => null,
    );

    return resultPromise;
  }, [proposal, routeBase, router]);
  persistProposalRef.current = persistProposal;

  async function activatePlan() {
    if (!activationValidation.isValid) {
      setFeedback({
        tone: "error",
        message: activationValidation.message,
      });
      return;
    }

    setFeedback(null);
    setIsActivating(true);

    try {
      const persistedProposal = await persistProposal();
      const targetSlug = persistedProposal.slug;

      const response = await fetch(`/api/sales-proposals/${targetSlug}/activate`, {
        method: "POST",
      });
      const payload = (await response.json()) as {
        url?: string;
        proposal?: SalesProposalRecord;
        message?: string;
      };

      if (!response.ok) {
        throw new Error(payload.message || "No pudimos activar el plan.");
      }

      if (payload.url) {
        window.location.href = payload.url;
        return;
      }

      if (!payload.proposal) {
        throw new Error(payload.message || "No pudimos completar la activacion del plan.");
      }

      setProposal(normalizeSalesProposalDraft(payload.proposal));
      setCouponCode(payload.proposal.appliedCouponCode);
      setIsCouponPanelOpen(Boolean(payload.proposal.appliedCouponCode.trim()));
      setFeedback({
        tone: "success",
        message: payload.message || "Plan activado correctamente.",
      });
    } catch (caughtError) {
      setFeedback({
        tone: "error",
        message: formatUserError(
          caughtError,
          "No pudimos activar el plan ni preparar el checkout del cliente.",
        ),
      });
    } finally {
      setIsActivating(false);
    }
  }

  useEffect(() => {
    const paymentStatus = searchParams.get("payment");
    const sessionId = searchParams.get("session_id");

    if (paymentStatus !== "success") {
      if (paymentStatus === "cancelled") {
        setFeedback({
          tone: "error",
          message: "El checkout se cancelo. La propuesta sigue guardada para que puedas intentarlo de nuevo.",
        });
        router.replace(pathname);
      }
      return;
    }

    if (!sessionId || !proposal.slug) {
      setFeedback({
        tone: "success",
        message: "Stripe proceso el pago y la propuesta quedo guardada correctamente.",
      });
      router.replace(pathname);
      return;
    }

    let isMounted = true;
    setIsSyncingPayment(true);
    setFeedback({
      tone: "success",
      message: "Confirmando pago...",
    });

    async function syncPayment() {
      try {
        const response = await fetch(`/api/sales-proposals/${proposal.slug}/sync-session`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sessionId,
          }),
        });
        const payload = (await response.json()) as {
          proposal?: SalesProposalRecord;
          message?: string;
        };

        if (!response.ok || !payload.proposal) {
          throw new Error(payload.message || "No pudimos confirmar el pago de la propuesta.");
        }

        if (!isMounted) return;

        setProposal(normalizeSalesProposalDraft(payload.proposal));
        setFeedback({
          tone: "success",
          message: "Pago confirmado. La propuesta ya no generara un checkout duplicado.",
        });
        router.replace(pathname);
      } catch (caughtError) {
        if (!isMounted) return;

        setFeedback({
          tone: "error",
          message: formatUserError(
            caughtError,
            "El pago se completo, pero no pudimos actualizar la propuesta automaticamente.",
          ),
        });
      } finally {
        if (isMounted) {
          setIsSyncingPayment(false);
        }
      }
    }

    void syncPayment();

    return () => {
      isMounted = false;
    };
  }, [pathname, proposal.slug, router, searchParams]);

  async function copyProspectShareLink() {
    if (isDinterwebVariant) {
      if (!hasValidClientEmail) {
        setFeedback({
          tone: "error",
          message: "Ingresa un correo valido del prospecto para generar primero la URL publica.",
        });
        return;
      }

      const persistedProposal = proposal.slug
        ? proposal
        : await persistProposal(proposal, { mergeWithCurrent: true });
      const shareUrl = `${window.location.origin}/public/prospect/${persistedProposal.slug}`;
      await navigator.clipboard.writeText(shareUrl);
      setFeedback({ tone: "success", message: "Link para prospecto copiado." });
      return;
    }

    if (!hasValidClientEmail) {
      setFeedback({
        tone: "error",
        message: "Ingresa un correo valido del cliente para generar primero la URL publica.",
      });
      return;
    }

    const persistedProposal = proposal.slug
      ? proposal
      : await persistProposal(proposal, { mergeWithCurrent: true });
    const shareUrl = `${window.location.origin}${routeBase}/${persistedProposal.slug}`;
    await navigator.clipboard.writeText(shareUrl);
    setFeedback({ tone: "success", message: "Enlace de propuesta copiado." });
  }

  async function copyClientShareLink() {
    if (!proposal.activatedClientId) {
      setFeedback({
        tone: "error",
        message: "El link para cliente se habilita cuando el plan ya fue activado.",
      });
      return;
    }

    const shareUrl = `${window.location.origin}/public/client/${proposal.activatedClientId}`;
    await navigator.clipboard.writeText(shareUrl);
    setFeedback({ tone: "success", message: "Link para cliente copiado." });
  }

  async function handleApplyCoupon() {
    const normalizedCode = couponCode.trim();

    if (!normalizedCode) {
      setFeedback({
        tone: "error",
        message: "Ingresa un cupon antes de intentar canjearlo.",
      });
      return;
    }

    setIsApplyingCoupon(true);
    setFeedback(null);

    try {
      const validationResponse = await fetch("/api/sales-proposals/validate-coupon", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ code: normalizedCode, workspaceVariant: variant }),
      });
      const validationPayload = (await validationResponse.json()) as {
        ok?: boolean;
        message?: string;
        coupon?: {
          couponType?: SalesCouponType;
          percentageOff?: number | null;
        };
      };

      if (!validationResponse.ok || !validationPayload.ok) {
        throw new Error(validationPayload.message || "No pudimos validar el cupon.");
      }

      const persistedProposal = await persistProposal();
      const response = await fetch(`/api/sales-proposals/${persistedProposal.slug}/apply-coupon`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ code: normalizedCode }),
      });
      const payload = (await response.json()) as {
        proposal?: SalesProposalRecord;
        message?: string;
      };

      if (!response.ok || !payload.proposal) {
        throw new Error(payload.message || "No pudimos validar el cupon.");
      }

      setProposal(normalizeSalesProposalDraft(payload.proposal));
      setCouponCode(payload.proposal.appliedCouponCode);
      setIsCouponPanelOpen(true);
      setFeedback({
        tone: "success",
        message: payload.message || "Cupon aplicado correctamente.",
      });
    } catch (caughtError) {
      setFeedback({
        tone: "error",
        message: formatUserError(caughtError, "No pudimos aplicar el cupon a la propuesta."),
      });
    } finally {
      setIsApplyingCoupon(false);
    }
  }

  async function handleRemoveCoupon() {
    if (!proposal.appliedCouponCode.trim()) {
      setFeedback({
        tone: "error",
        message: "La propuesta no tiene un cupon aplicado.",
      });
      return;
    }

    setIsRemovingCoupon(true);
    setFeedback(null);

    try {
      const persistedProposal = await persistProposal();
      const response = await fetch(`/api/sales-proposals/${persistedProposal.slug}/remove-coupon`, {
        method: "POST",
      });
      const payload = (await response.json()) as {
        proposal?: SalesProposalRecord;
        message?: string;
      };

      if (!response.ok || !payload.proposal) {
        throw new Error(payload.message || "No pudimos remover el cupon.");
      }

      const normalizedProposal = normalizeSalesProposalDraft(payload.proposal);
      setProposal(normalizedProposal);
      setCouponCode("");
      setIsCouponPanelOpen(false);

      if (normalizedProposal.workspaceVariant === "dinterweb") {
        setDinterwebPlanCreditsDraft(
          String(Math.max(DINTERWEB_MIN_PACKAGE.credits, getDinterwebMonthlyCredits(normalizedProposal))),
        );
        setDinterwebPlanPriceDraft(
          String(Math.max(DINTERWEB_MIN_PACKAGE.price, getDinterwebMonthlyPrice(normalizedProposal))),
        );
      }

      setFeedback({
        tone: "success",
        message: payload.message || "Cupon removido correctamente.",
      });
    } catch (caughtError) {
      setFeedback({
        tone: "error",
        message: formatUserError(caughtError, "No pudimos remover el cupon de la propuesta."),
      });
    } finally {
      setIsRemovingCoupon(false);
    }
  }

  function handleRedeemCoupon() {
    setIsCouponPanelOpen((current) => !current);
  }

  function updateProposalStartDate(nextStartDate: string) {
    const nextProposal = {
      ...proposal,
      startDate: nextStartDate,
      initiatives: nextStartDate
        ? normalizeBoardSortOrders(
            alignInitiativesToProposalStartDate(proposal.initiatives, nextStartDate),
          )
        : proposal.initiatives,
    };

    setProposal(nextProposal);

    if (initiativeDraft) {
      const syncedDraft =
        nextProposal.initiatives.find((initiative) => initiative.id === initiativeDraft.id) ?? null;
      if (syncedDraft) {
        setInitiativeDraft(createEditorDraft(syncedDraft));
      }
    }
  }

  const persistGanttDates = useCallback(async (initiativeId: string, startDate: string, endDate: string) => {
    const targetInitiative = proposal.initiatives.find((initiative) => initiative.id === initiativeId);
    if (!targetInitiative) return;

    if (targetInitiative.isBlocked) {
      setFeedback({
        tone: "error",
        message: "Esta iniciativa esta bloqueada. Debes desbloquearla antes de ajustar sus fechas.",
      });
      return;
    }

    const previousSignature = lastPersistedSignatureRef.current;
    const nextProposal = normalizeSalesProposalDraft({
      ...proposal,
      initiatives: proposal.initiatives.map((initiative) =>
        initiative.id === initiativeId
          ? {
              ...initiative,
              estStartDate: startDate,
              estEndDate: endDate,
            }
          : initiative,
      ),
    });

    setProposal(nextProposal);

    if (initiativeDraft?.id === initiativeId) {
      const syncedDraft = nextProposal.initiatives.find((initiative) => initiative.id === initiativeId);
      if (syncedDraft) {
        setInitiativeDraft(createEditorDraft(syncedDraft));
      }
    }

    if (!canPersistSalesProposal(nextProposal)) {
      setFeedback({
        tone: "success",
        message: `Fechas ajustadas localmente: ${formatDateRange(startDate, endDate)}. Agrega un correo valido del cliente para guardarlas con URL.`,
      });
      return;
    }

    setFeedback(null);
    setIsSavingTimelineDates(true);
    lastPersistedSignatureRef.current = getSalesProposalAutosaveSignature(nextProposal);

    try {
      await persistProposal(nextProposal, { mergeWithCurrent: true });
      setFeedback({
        tone: "success",
        message: `Fechas actualizadas en Plan de Trabajo: ${formatDateRange(startDate, endDate)}.`,
      });
    } catch (caughtError) {
      lastPersistedSignatureRef.current = previousSignature;
      setFeedback({
        tone: "error",
        message: formatUserError(
          caughtError,
          "No pudimos actualizar las fechas desde el Plan de Trabajo.",
        ),
      });
    } finally {
      setIsSavingTimelineDates(false);
    }
  }, [initiativeDraft, persistProposal, proposal]);

  const committedWidth = Math.min((metrics.committed / Math.max(metrics.total, 1)) * 100, 100);
  const availableWidth = Math.min((metrics.available / Math.max(metrics.total, 1)) * 100, 100);
  const hasPlanningItems =
    groupedInitiatives.backlog.length > 0 || groupedInitiatives.planned.length > 0;
  const hasBoardItems = boardStatuses.some((status) => groupedInitiatives[status].length > 0);
  const isOverCapacity = metrics.committed > metrics.total;
  const currentPlanCredits = proposal.initiatives.reduce(
    (sum, initiative) =>
      initiative.status === "planned" || initiative.status === "executing"
        ? sum + calculateSalesInitiativeCredits(initiative)
        : sum,
    0,
  );
  const remainingRecommendationCredits = Math.max(0, proposal.contractedCredits - currentPlanCredits);
  const dinterwebMonthlyCredits = getDinterwebMonthlyCredits(proposal);
  const dinterwebMonthlyPrice = getDinterwebMonthlyPrice(proposal);
  const hasDinterwebCustomPackage =
    dinterwebMonthlyCredits !== DINTERWEB_DEFAULT_PACKAGE.credits ||
    dinterwebMonthlyPrice !== DINTERWEB_DEFAULT_PACKAGE.price;
  const upsellPackagePrice =
    packageOptions.find((option) => option.credits === upsellPackageCredits)?.price ??
    packageOptions[0].price;
  const hubspotUpsellCount = getCurrentHubspotUpsellCount(proposal, packageOptions[0]);
  const upsellCreditsAdded = upsellPackageCredits * upsellCartCount;
  const upsellTotalPrice = SALES_PROPOSAL_BASE_PRICE + upsellPackagePrice * upsellCartCount;
  const hasHubspotUpsell =
    proposal.contractedCredits > SALES_PROPOSAL_BASE_CREDITS ||
    proposal.quotedPrice > SALES_PROPOSAL_BASE_PRICE;
  const activationValidation = getSalesProposalActivationValidation(proposal);
  const hasClientEmail = proposal.clientEmail.trim().length > 0;
  const hasValidClientEmail = isValidSalesProposalClientEmail(proposal.clientEmail);
  const showClientEmailError = hasClientEmail && !hasValidClientEmail;
  const hasAppliedCoupon = Boolean(proposal.appliedCouponCode.trim());
  const appliedCouponOriginalPrice =
    proposal.appliedCouponType === "percentage" && proposal.couponBaseQuotedPrice !== null
      ? proposal.couponBaseQuotedPrice
      : null;
  const appliedCouponLabel = hasAppliedCoupon
    ? `Cupon aplicado: ${proposal.appliedCouponCode} · ${proposal.contractedCredits} CR · ${formatCurrency(proposal.quotedPrice, proposal.currency.toUpperCase())}`
    : "Canjear cupon";
  const percentageCouponLabel =
    proposal.appliedCouponType === "percentage" && proposal.appliedCouponPercentageOff
      ? `Cupon aplicado: ${proposal.appliedCouponCode} · ${proposal.appliedCouponPercentageOff}% OFF · ${appliedCouponOriginalPrice !== null ? `${formatCurrency(appliedCouponOriginalPrice, proposal.currency.toUpperCase())} -> ` : ""}${formatCurrency(proposal.quotedPrice, proposal.currency.toUpperCase())}`
      : appliedCouponLabel;
  const isProposalCheckoutLocked =
    proposal.status === "checkout_pending" ||
    proposal.status === "transfer_pending" ||
    proposal.status === "paid" ||
    proposal.status === "board_activated";
  const defaultCatalogLibraryTab =
    catalogTabs.find((tab) => tab.id !== "wizard")?.id ?? "wizard";
  const activatePlanButtonLabel =
    proposal.status === "board_activated"
      ? "Plan Activado"
      : proposal.status === "paid"
        ? "Pagada"
        : proposal.status === "transfer_pending"
          ? "Pendiente Finanzas"
        : proposal.status === "checkout_pending"
          ? "Checkout Pendiente"
          : isActivating
            ? "Activando..."
            : isSyncingPayment
              ? "Confirmando..."
              : "Activar Plan";
  const isActivatePlanDisabled =
    isActivating || isSyncingPayment || isProposalCheckoutLocked;
  const isUpsellDisabled = hasAppliedCoupon || isProposalCheckoutLocked;
  const wizardLoadingMessage =
    WIZARD_LOADING_MESSAGES[wizardLoadingMessageIndex] ?? WIZARD_LOADING_MESSAGES[0];

  async function exportSalesPlanPdf() {
    setFeedback(null);
    setIsExportingReport(true);

    try {
      await exportPlanReportPdf(
        "sales-plan-report-export-root",
        `Plan_${proposal.workspaceVariant === "dinterweb" ? "Dinterweb" : "HubSpot"}_${proposal.clientName || proposal.clientCompany || "Prospecto"}_${Date.now()}.pdf`,
      );
      setFeedback({ tone: "success", message: "PDF del plan generado correctamente." });
    } catch (caughtError) {
      setFeedback({
        tone: "error",
        message: formatUserError(caughtError, "No fue posible generar el PDF del plan."),
      });
    } finally {
      setIsExportingReport(false);
    }
  }

  useEffect(() => {
    if (!ganttDrag) return;
    const activeDrag = ganttDrag;

    function handlePointerMove(event: PointerEvent) {
      const deltaX = event.clientX - activeDrag.originX;
      const nextDelta = getSnappedDayDelta(deltaX, timelineRows.dayWidth);
      setGanttDrag((current) => (current ? { ...current, dayDelta: nextDelta } : current));
    }

    function handlePointerUp() {
      setGanttDrag(null);

      if (!activeDrag || activeDrag.dayDelta === 0) {
        return;
      }

      const initiative = proposal.initiatives.find((item) => item.id === activeDrag.initiativeId);
      if (!initiative) return;

      const startBase = parseCalendarDate(activeDrag.startDate);
      const endBase = parseCalendarDate(activeDrag.endDate);
      let nextStart = activeDrag.startDate;
      let nextEnd = activeDrag.endDate;

      if (activeDrag.mode === "move") {
        nextStart = toIsoDate(addCalendarDays(startBase, activeDrag.dayDelta));
        nextEnd = toIsoDate(addCalendarDays(endBase, activeDrag.dayDelta));
      } else if (activeDrag.mode === "resize-start") {
        const candidateStart = addCalendarDays(startBase, activeDrag.dayDelta);
        const normalizedStart = candidateStart > endBase ? endBase : candidateStart;
        nextStart = toIsoDate(normalizedStart);
      } else {
        const candidateEnd = addCalendarDays(endBase, activeDrag.dayDelta);
        const normalizedEnd = candidateEnd < startBase ? startBase : candidateEnd;
        nextEnd = toIsoDate(normalizedEnd);
      }

      void persistGanttDates(initiative.id, nextStart, nextEnd);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [ganttDrag, persistGanttDates, proposal.initiatives, timelineRows.dayWidth]);

  useEffect(() => {
    const autosaveSignature = getSalesProposalAutosaveSignature(proposal);
    const canAutosave =
      proposal.status === "draft" &&
      canPersistSalesProposal(proposal);

    if (!canAutosave || autosaveSignature === lastPersistedSignatureRef.current) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void persistProposal(proposal, { mergeWithCurrent: true }).catch((caughtError) => {
        setFeedback({
          tone: "error",
          message: formatUserError(
            caughtError,
            "No pudimos guardar automaticamente la propuesta comercial.",
          ),
        });
      });
    }, 900);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [persistProposal, proposal]);

  return (
    <div className="min-h-screen bg-[#fcfcfc] pb-14 text-[#33475b]">
      <header className="sticky top-0 z-30 border-b border-[#dfe3eb] bg-white shadow-sm">
        <div className="flex items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-6">
            <BrandLogo href={workspaceHomeHref} priority />
          </div>
          <div className="flex items-center gap-4 text-[12.5px] font-medium text-[#516f90]">
            {isDinterwebVariant ? (
              <>
                <button
                  type="button"
                  onClick={() => router.push("/sales/dinterweb")}
                  className="inline-flex items-center gap-1.5 font-semibold transition hover:text-[#33475b]"
                >
                  Mis prospectos
                </button>
                <span className="h-4 w-px bg-[#dfe3eb]" />
              </>
            ) : null}
            <button
              type="button"
              onClick={() => {
                pendingProposalSlugRef.current = null;
                setProposal(createNewSalesProposalDraft(variant, sellerPreset));
              }}
              className="inline-flex items-center gap-1.5 transition hover:text-[#ff7a59]"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Limpiar
            </button>
            <span className="h-4 w-px bg-[#dfe3eb]" />
            <button
              type="button"
              onClick={() => void exportSalesPlanPdf()}
              disabled={isExportingReport}
              className="inline-flex items-center gap-1.5 font-semibold text-[#516f90] transition hover:text-[#33475b] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              {isExportingReport ? "Generando..." : "PDF Plan"}
            </button>
            <span className="h-4 w-px bg-[#dfe3eb]" />
            {isDinterwebVariant ? (
              <>
                <button
                  type="button"
                  onClick={copyProspectShareLink}
                  className="inline-flex items-center gap-1.5 font-semibold text-[#00bda5] transition hover:text-[#009c88]"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  Compartir prospecto
                </button>
                <button
                  type="button"
                  onClick={copyClientShareLink}
                  disabled={!proposal.activatedClientId}
                  className="inline-flex items-center gap-1.5 font-semibold text-[#516f90] transition hover:text-[#33475b] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  Compartir cliente
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={copyProspectShareLink}
                className="inline-flex items-center gap-1.5 font-semibold text-[#00bda5] transition hover:text-[#009c88]"
              >
                <Link2 className="h-3.5 w-3.5" />
                Compartir Link
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="w-full">
        <section className="border-b border-[#dfe3eb] bg-white px-6 py-4">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex-1 space-y-4">
              <div className="flex flex-wrap items-center gap-4">
                <div className="min-w-[180px]">
                  <input
                    value={proposal.clientName}
                    onChange={(event) =>
                      setProposal({
                        ...proposal,
                        clientName: event.target.value,
                        clientCompany: event.target.value,
                      })
                    }
                    className="w-full border-0 border-b border-transparent bg-transparent p-0 text-[15px] font-bold leading-none text-[#33475b] outline-none transition focus:border-[#00bda5]"
                  />
                </div>
                <div className="min-w-[220px] flex-1 max-w-[320px]">
                  <input
                    type="email"
                    value={proposal.clientEmail}
                    onChange={(event) => setProposal({ ...proposal, clientEmail: event.target.value })}
                    aria-invalid={showClientEmailError}
                    className={`w-full border-0 border-b bg-transparent p-0 text-[13px] font-medium leading-none outline-none transition placeholder:text-[#9cb1c6] ${
                      showClientEmailError
                        ? "border-[#dc2626] text-[#b91c1c] focus:border-[#dc2626]"
                        : "border-transparent text-[#516f90] focus:border-[#00bda5]"
                    }`}
                    placeholder="cliente@empresa.com"
                  />
                </div>
                <div className="min-w-[180px] flex-1 max-w-[280px]">
                  <input
                    type="text"
                    value={proposal.clientDomain}
                    onChange={(event) => setProposal({ ...proposal, clientDomain: event.target.value })}
                    className="w-full border-0 border-b border-transparent bg-transparent p-0 text-[13px] font-medium leading-none text-[#516f90] outline-none transition placeholder:text-[#9cb1c6] focus:border-[#00bda5]"
                    placeholder="dominio.com"
                  />
                </div>
                <span className="hidden h-4 w-px bg-[#dfe3eb] md:block" />
                <div className="flex items-center gap-2 rounded-[4px] px-1.5 py-1 text-[12px] font-medium text-[#516f90] transition hover:bg-[#f5f8fa]">
                  <CalendarDays className="h-3.5 w-3.5" />
                  <span className="text-[12px] font-medium text-[#516f90]">Inicio:</span>
                  <input
                    type="date"
                    value={proposal.startDate}
                    onChange={(event) => updateProposalStartDate(event.target.value)}
                    disabled={isProposalCheckoutLocked}
                    className="w-[124px] border-0 border-b border-transparent bg-transparent p-0 text-[12px] font-semibold leading-none text-[#33475b] outline-none transition focus:border-[#00bda5] disabled:cursor-not-allowed disabled:text-[#8aa0b4]"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-6 text-[12px] font-medium">
                <div className="flex items-baseline gap-1.5">
                  <span className="uppercase tracking-[0.14em] text-[#9cb1c6]">Disponibles</span>
                  <span className="text-[16px] font-bold text-[#00bda5]">{metrics.available} créditos</span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="uppercase tracking-[0.14em] text-[#9cb1c6]">Comprometidos</span>
                  <span className="text-[16px] font-bold text-[#6a78d1]">{metrics.committed} créditos</span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="uppercase tracking-[0.14em] text-[#9cb1c6]">Completados</span>
                  <span className="text-[16px] font-bold text-[#33475b]">{metrics.completed} créditos</span>
                </div>
              </div>

            </div>

            <div className="w-full max-w-[520px] rounded-[6px] border border-[#cbd6e2] bg-white shadow-sm transition hover:shadow-md xl:w-[520px] xl:max-w-[520px]">
              <div className="flex items-stretch">
                <div className="flex min-w-[112px] flex-col justify-center px-2.5 py-2">
                  <p className="text-[7px] font-bold uppercase tracking-[0.16em] text-[#9cb1c6]">
                    Inversión total
                  </p>
                  <p className="mt-1 whitespace-nowrap text-[18px] font-extrabold leading-none text-[#33475b] [font-variant-numeric:tabular-nums]">
                    {formatCurrency(proposal.quotedPrice, proposal.currency.toUpperCase())}
                  </p>
                </div>
                <div className="my-1 w-px bg-[#dfe3eb]" />
                <div className="flex shrink-0 items-center px-1.5">
                  <span className="inline-flex h-9 min-w-[78px] items-center justify-center whitespace-nowrap rounded-[2px] border border-[#9fe7dc] bg-[#ecfffb] px-2 text-[12px] font-bold text-[#00bda5] [font-variant-numeric:tabular-nums]">
                    {proposal.contractedCredits} CR
                  </span>
                </div>
                <div className="my-1 w-px bg-[#dfe3eb]" />
                <div className="flex shrink-0 items-center gap-1 px-1">
                  {isDinterwebVariant ? (
                    <>
                      <button
                        type="button"
                        onClick={() => adjustDinterwebPackage(-1)}
                        disabled={
                          isUpsellDisabled ||
                          dinterwebMonthlyCredits <= dinterwebPackageCreditsStep ||
                          dinterwebMonthlyPrice <= dinterwebPackagePriceStep
                        }
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-[4px] border border-[#cbd6e2] bg-[#f5f8fa] text-[#516f90] transition hover:border-[#ff7a59] hover:bg-[#ff7a59] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label="Reducir capacidad"
                        title="Reducir capacidad"
                      >
                        <Minus className="h-2.5 w-2.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => adjustDinterwebPackage(1)}
                        disabled={isUpsellDisabled}
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-[4px] border border-[#cbd6e2] bg-[#f5f8fa] text-[#516f90] transition hover:border-[#ff7a59] hover:bg-[#ff7a59] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label="Aumentar capacidad"
                        title="Aumentar capacidad"
                      >
                        <Plus className="h-2.5 w-2.5" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => adjustHubspotPackage(-1)}
                        disabled={isUpsellDisabled || hubspotUpsellCount <= 0}
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-[4px] border border-[#cbd6e2] bg-[#f5f8fa] text-[#516f90] transition hover:border-[#ff7a59] hover:bg-[#ff7a59] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label="Quitar paquete de creditos"
                        title="Quitar paquete de creditos"
                      >
                        <Minus className="h-2.5 w-2.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => adjustHubspotPackage(1)}
                        disabled={isUpsellDisabled}
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-[4px] border border-[#cbd6e2] bg-[#f5f8fa] text-[#516f90] transition hover:border-[#ff7a59] hover:bg-[#ff7a59] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label="Agregar paquete de creditos"
                        title="Agregar paquete de creditos"
                      >
                        <Plus className="h-2.5 w-2.5" />
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={openUpsellModal}
                    disabled={isUpsellDisabled}
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-[4px] border border-[#cbd6e2] bg-[#f5f8fa] text-[#516f90] transition hover:border-[#ff7a59] hover:bg-[#ff7a59] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="Configurar paquete"
                    title="Configurar paquete"
                  >
                    <SlidersHorizontal className="h-2.5 w-2.5" />
                  </button>
                </div>
                <div className="my-1 w-px bg-[#dfe3eb]" />
                <div className="flex min-w-0 flex-1 items-center px-1 py-1">
                  <button
                    type="button"
                    onClick={activatePlan}
                    disabled={isActivatePlanDisabled}
                    className="inline-flex h-10 w-full min-w-[150px] items-center justify-center gap-1.5 whitespace-nowrap rounded-[4px] bg-[#ff7a59] px-3 text-[13px] font-bold text-white transition hover:bg-[#dc6548] disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    <span className="whitespace-nowrap">{activatePlanButtonLabel}</span>
                    <Sparkles className="h-3 w-3 shrink-0" />
                  </button>
                </div>
              </div>

              {isDinterwebVariant ? (
                <div className="border-t border-[#dfe3eb] px-3 py-3">
                  <div className="grid gap-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="space-y-1">
                        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#9cb1c6]">
                          Tipo de cobro
                        </span>
                        <select
                          value={proposal.billingMode}
                          onChange={(event) =>
                            applyDinterwebCommercialTerms(
                              dinterwebMonthlyCredits,
                              dinterwebMonthlyPrice,
                              event.target.value === "subscription" ? "subscription" : "one_time",
                              event.target.value === "subscription" ? proposal.periodMonths : 1,
                            )
                          }
                          disabled={isProposalCheckoutLocked}
                          className="h-9 w-full rounded-[4px] border border-[#cbd6e2] bg-white px-3 text-[12px] font-bold text-[#33475b] outline-none transition focus:border-[#00bda5] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <option value="one_time">Paquete de creditos</option>
                          <option value="subscription">Recurrencia</option>
                        </select>
                      </label>

                      <label className="space-y-1">
                        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#9cb1c6]">
                          Frecuencia
                        </span>
                        <select
                          value={String(proposal.periodMonths)}
                          onChange={(event) =>
                            applyDinterwebCommercialTerms(
                              dinterwebMonthlyCredits,
                              dinterwebMonthlyPrice,
                              proposal.billingMode,
                              safeParseNumber(event.target.value) === 3
                                ? 3
                                : safeParseNumber(event.target.value) === 6
                                  ? 6
                                  : safeParseNumber(event.target.value) === 12
                                    ? 12
                                    : 1,
                            )
                          }
                          disabled={proposal.billingMode !== "subscription" || isProposalCheckoutLocked}
                          className="h-9 w-full rounded-[4px] border border-[#cbd6e2] bg-white px-3 text-[12px] font-bold text-[#33475b] outline-none transition focus:border-[#00bda5] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <option value="1">Mensual</option>
                          <option value="3">Trimestral</option>
                          <option value="6">Semestral</option>
                          <option value="12">Anual</option>
                        </select>
                      </label>
                    </div>

                  </div>
                </div>
              ) : null}

              <div className="border-t border-[#dfe3eb] px-3 py-3">
                <div className="flex flex-col items-center gap-2.5">
                  <button
                    type="button"
                    onClick={hasAppliedCoupon ? undefined : handleRedeemCoupon}
                    className="inline-flex h-10 w-full items-center justify-center rounded-[4px] border border-[#9fe7dc] bg-[#ecfffb] px-4 text-[12px] font-bold text-[#00bda5] transition hover:border-[#00bda5] hover:bg-[#d7fff7] hover:text-[#009c88] disabled:cursor-not-allowed disabled:opacity-75"
                    disabled={hasAppliedCoupon}
                  >
                    {hasAppliedCoupon ? percentageCouponLabel : appliedCouponLabel}
                  </button>

                  {hasAppliedCoupon ? (
                    <button
                      type="button"
                      onClick={handleRemoveCoupon}
                      disabled={isRemovingCoupon}
                      className="inline-flex h-9 w-full items-center justify-center rounded-[4px] border border-[#ffbcac] bg-white px-4 text-[12px] font-bold text-[#ff7a59] transition hover:border-[#ff7a59] hover:bg-[#fff3ef] disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {isRemovingCoupon ? "Quitando..." : "Quitar cupon"}
                    </button>
                  ) : null}

                  {!hasAppliedCoupon && isCouponPanelOpen ? (
                    <div className="w-full rounded-[4px] border border-[#d7efe8] bg-[#f7fffc] p-2.5">
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <input
                          type="text"
                          value={couponCode}
                          onChange={(event) => setCouponCode(event.target.value.toUpperCase())}
                          placeholder="Ingresa el cupon"
                          className="h-10 flex-1 rounded-[4px] border border-[#cbd6e2] bg-white px-3 text-[12px] font-medium text-[#33475b] outline-none transition placeholder:text-[#9cb1c6] focus:border-[#00bda5]"
                        />
                        <button
                          type="button"
                          onClick={handleApplyCoupon}
                          disabled={isApplyingCoupon}
                          className="inline-flex h-10 items-center justify-center rounded-[4px] bg-[#00bda5] px-4 text-[12px] font-bold text-white transition hover:bg-[#009c88] disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {isApplyingCoupon ? "Aplicando..." : "Aplicar cupon"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 flex h-1.5 w-full overflow-hidden rounded-full bg-[#eaf0f6]">
            <div className="h-full bg-[#6a78d1]" style={{ width: `${committedWidth}%` }} />
            <div className="h-full bg-[#00bda5]" style={{ width: `${availableWidth}%` }} />
          </div>

          {isOverCapacity ? (
            <div className="mt-3 flex flex-col gap-3 rounded-[4px] border border-[#ef4444]/30 bg-[#fff0f0] px-3 py-2.5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[12px] font-medium text-[#ef4444]">
                La propuesta supera la capacidad disponible. Ajusta el alcance o agrega mas creditos antes de activar.
              </p>
              <button
                type="button"
                onClick={openUpsellModal}
                disabled={isUpsellDisabled}
                className="inline-flex h-8 items-center justify-center rounded-[3px] bg-[#ff7a59] px-3 text-[11px] font-bold text-white transition hover:bg-[#dc6548] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Anadir creditos
              </button>
            </div>
          ) : null}

          

        </section>

        <section className="border-b border-[#dfe3eb] bg-[#f5f8fa] px-6 py-6">
          <div className="overflow-x-auto overflow-y-hidden">
            <div className="flex min-h-[420px] min-w-max gap-6">
              {boardStatuses.map((status) => {
                if (!hasBoardItems && status !== "backlog") {
                  return null;
                }

                const items = groupedInitiatives[status];
                const totalCredits = items.reduce(
                  (sum, initiative) => sum + calculateSalesInitiativeCredits(initiative),
                  0,
                );

                if (!hasBoardItems && status === "backlog") {
                  if (isDinterwebVariant) {
                    return (
                      <div key="planning-empty-state" className="flex min-w-[1352px] flex-col">
                        <div className="flex gap-6">
                          {boardStatuses.map((emptyStatus) => (
                            <div
                              key={`empty-${emptyStatus}`}
                              className={`flex w-[320px] min-w-[320px] max-w-[340px] flex-col ${getMobileBoardStatusOrderClass(emptyStatus)}`}
                            >
                              <div className="mb-2 flex items-center justify-between px-1">
                                <div className="flex items-center gap-2">
                                  <span className={`h-2.5 w-2.5 rounded-full ${getStatusDot(emptyStatus)}`} />
                                  <p
                                    className={`text-[13px] font-bold uppercase tracking-[0.18em] ${getStatusHeadingClass(emptyStatus)}`}
                                  >
                                    {getStatusLabel(emptyStatus)}
                                  </p>
                                </div>
                                <span className="rounded-[2px] bg-[#eaf0f6] px-2 py-0.5 text-[11px] font-bold text-[#516f90]">
                                  0 CR
                                </span>
                              </div>

                              {canManageSalesStage(emptyStatus) ? (
                                <div className="rounded-[4px] border border-dashed border-[#cbd6e2] bg-white p-2 shadow-[0_1px_2px_rgba(51,71,91,0.06)]">
                                  {renderDinterwebStageComposer(emptyStatus)}
                                </div>
                              ) : (
                                <div className="rounded-[4px] border border-dashed border-[#cbd6e2] bg-[#f5f8fa] px-3 py-4 text-[10px] text-[#9cb1c6]">
                                  Vacio
                                </div>
                              )}
                            </div>
                          ))}
                        </div>

                        <div className="mt-28 w-[664px] min-w-[664px] rounded-[8px] border border-[#8ee1d5] bg-[#e8fffb] p-4 shadow-[0_8px_24px_rgba(0,189,165,0.14)]">
                          <button
                            type="button"
                            onClick={() => openCatalogModal(defaultCatalogLibraryTab)}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-[6px] bg-[#14b8a6] px-8 py-3.5 text-[14px] font-extrabold text-white shadow-md transition hover:-translate-y-0.5 hover:bg-[#0ea899]"
                          >
                            <Plus className="h-4 w-4" />
                            <span>Agregar casos de uso</span>
                          </button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key="planning-empty-state" className="flex min-w-[1352px] gap-6">
                      <div className="flex min-w-[666px] flex-col">
                        <div className="mb-2 grid grid-cols-2 gap-6">
                          <div className="flex items-center justify-between px-1">
                            <div className="flex items-center gap-2">
                              <span className={`h-2.5 w-2.5 rounded-full ${getStatusDot("backlog")}`} />
                              <p className="text-[13px] font-bold uppercase tracking-[0.18em] text-[#516f90]">
                                {getStatusLabel("backlog")}
                              </p>
                            </div>
                            <span className="rounded-[2px] bg-[#eaf0f6] px-2 py-0.5 text-[11px] font-bold text-[#516f90]">
                              0 CR
                            </span>
                          </div>

                          <div className="flex items-center justify-between px-1">
                            <div className="flex items-center gap-2">
                              <span className={`h-2.5 w-2.5 rounded-full ${getStatusDot("planned")}`} />
                              <p className="text-[13px] font-bold uppercase tracking-[0.18em] text-[#6a78d1]">
                                {getStatusLabel("planned")}
                              </p>
                            </div>
                            <span className="rounded-[2px] bg-[#f0f2fb] px-2 py-0.5 text-[11px] font-bold text-[#6a78d1]">
                              0 CR
                            </span>
                          </div>
                        </div>

                        <div className="flex min-h-[404px] flex-1 rounded-[6px] border-2 border-dashed border-[#9fe7dc] bg-[#f5f8fa] p-10">
                          <div className="mx-auto mt-6 flex w-full max-w-[580px] flex-col items-center rounded-[8px] border border-[#eaf0f6] bg-white px-10 py-9 text-center shadow-[0_10px_30px_rgba(0,189,165,0.12)]">
                            <div className="mb-6 h-1 w-[calc(100%+80px)] -mt-9 bg-[#00bda5]" />
                            <p className="text-[13.5px] leading-[1.8] text-[#516f90]">
                              Aqui definimos como activar HubSpot de forma{" "}
                              <strong className="font-extrabold text-[#46668b]">enfocada desde el inicio</strong>.
                              <br />
                              Seleccionamos los casos de uso que{" "}
                              <strong className="font-extrabold text-[#46668b]">mas sentido tienen para tu operacion hoy</strong>{" "}
                              y el orden en el que conviene trabajarlos para{" "}
                              <strong className="font-extrabold text-[#46668b]">empezar a ver resultados rapidamente</strong>.
                            </p>
                            <button
                              type="button"
                              onClick={() => openCatalogModal(defaultCatalogLibraryTab)}
                              className="mt-8 inline-flex min-w-[282px] items-center justify-center gap-2 rounded-[4px] bg-[#14b8a6] px-8 py-3.5 text-[14px] font-extrabold text-white shadow-md transition hover:-translate-y-0.5 hover:bg-[#0ea899]"
                            >
                              <Plus className="h-4 w-4" />
                              <span>Agregar casos de uso</span>
                            </button>
                          </div>
                        </div>
                      </div>

                      {(["executing", "completed"] as InitiativeStatus[]).map((emptyStatus) => {
                        const stageItems = groupedInitiatives[emptyStatus];
                        const stageCredits = stageItems.reduce(
                          (sum, initiative) => sum + calculateSalesInitiativeCredits(initiative),
                          0,
                        );

                        return (
                          <div
                            key={`empty-hubspot-${emptyStatus}`}
                            className={`flex w-[320px] min-w-[320px] max-w-[340px] flex-col ${getMobileBoardStatusOrderClass(emptyStatus)}`}
                          >
                            <div className="mb-2 flex items-center justify-between px-1">
                              <div className="flex items-center gap-2">
                                <span className={`h-2.5 w-2.5 rounded-full ${getStatusDot(emptyStatus)}`} />
                                <p
                                  className={`text-[13px] font-bold uppercase tracking-[0.18em] ${getStatusHeadingClass(emptyStatus)}`}
                                >
                                  {getStatusLabel(emptyStatus)}
                                </p>
                              </div>
                              <span className="rounded-[2px] bg-[#eaf0f6] px-2 py-0.5 text-[11px] font-bold text-[#516f90]">
                                {stageCredits} CR
                              </span>
                            </div>

                            <div
                              className={`min-h-[360px] flex-1 space-y-2.5 rounded-[6px] px-1 pt-1 transition ${
                                dropTargetStatus === emptyStatus ? "bg-[#eef6ff] ring-1 ring-inset ring-[#bfd4ec]" : ""
                              }`}
                              onDragOver={(event) => {
                                const draggedInitiative = proposal.initiatives.find(
                                  (item) => item.id === draggedInitiativeId,
                                );

                                if (
                                  !draggedInitiative ||
                                  !canDropSalesInitiativeIntoStatus(draggedInitiative.status, emptyStatus)
                                ) {
                                  return;
                                }

                                event.preventDefault();
                                event.dataTransfer.dropEffect = "move";
                                setDropTargetStatus(emptyStatus);
                                setDropIndicator({ status: emptyStatus, initiativeId: null, position: "after" });
                              }}
                              onDragLeave={(event) => {
                                if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                                setDropTargetStatus((current) => (current === emptyStatus ? null : current));
                                setDropIndicator((current) =>
                                  current?.status === emptyStatus && current.initiativeId === null ? null : current,
                                );
                              }}
                              onDrop={(event) => {
                                event.preventDefault();

                                const initiativeId =
                                  event.dataTransfer.getData("text/plain") || draggedInitiativeId;
                                const initiative = proposal.initiatives.find((item) => item.id === initiativeId);

                                if (!initiative) {
                                  setDraggedInitiativeId(null);
                                  setDropTargetStatus(null);
                                  setDropIndicator(null);
                                  return;
                                }

                                moveInitiativeToStatus(initiative, emptyStatus);
                              }}
                            >
                              {stageItems.length ? (
                                stageItems.map((initiative) => {
                                  const credits = calculateSalesInitiativeCredits(initiative);
                                  const originalCredits = calculateSalesInitiativeOriginalCredits(initiative);
                                  const progress = calculateSalesInitiativeProgress(initiative);
                                  const isDraggable = true;

                                  return (
                                    <button
                                      key={initiative.id}
                                      type="button"
                                      onClick={() => openInitiativeEditor(initiative)}
                                      draggable={isDraggable}
                                      onDragStart={(event) => {
                                        event.dataTransfer.setData("text/plain", initiative.id);
                                        event.dataTransfer.effectAllowed = "move";
                                        setDraggedInitiativeId(initiative.id);
                                      }}
                                      onDragOver={(event) => {
                                        if (draggedInitiativeId === initiative.id) return;
                                        const draggedInitiative = proposal.initiatives.find(
                                          (item) => item.id === draggedInitiativeId,
                                        );

                                        if (
                                          !draggedInitiative ||
                                          !canDropSalesInitiativeIntoStatus(draggedInitiative.status, emptyStatus)
                                        ) {
                                          return;
                                        }

                                        event.preventDefault();
                                        event.stopPropagation();
                                        event.dataTransfer.dropEffect = "move";
                                        setDropTargetStatus(emptyStatus);
                                        setDropIndicator({
                                          status: emptyStatus,
                                          initiativeId: initiative.id,
                                          position: getDropPosition(event),
                                        });
                                      }}
                                      onDrop={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();

                                        const initiativeId =
                                          event.dataTransfer.getData("text/plain") || draggedInitiativeId;
                                        const draggedInitiative = proposal.initiatives.find(
                                          (item) => item.id === initiativeId,
                                        );

                                        if (!draggedInitiative) {
                                          setDraggedInitiativeId(null);
                                          setDropTargetStatus(null);
                                          setDropIndicator(null);
                                          return;
                                        }

                                        moveInitiativeToStatus(draggedInitiative, emptyStatus, {
                                          targetInitiativeId: initiative.id,
                                          position: getDropPosition(event),
                                        });
                                      }}
                                      onDragEnd={() => {
                                        setDraggedInitiativeId(null);
                                        setDropTargetStatus(null);
                                        setDropIndicator(null);
                                      }}
                                      className={`relative w-full rounded-[7px] border px-3.5 py-3.5 text-left shadow-[0_1px_3px_rgba(51,71,91,0.07)] transition hover:-translate-y-[1px] hover:border-[#cbd6e2] hover:shadow-[0_8px_24px_rgba(51,71,91,0.08)] cursor-grab active:cursor-grabbing ${
                                        initiative.commerciallyWaived
                                          ? "border-[#9ee7db] bg-[#f0fffc]"
                                          : "border-[#d8e2ec] bg-white"
                                      } ${
                                        dropIndicator?.status === emptyStatus &&
                                        dropIndicator.initiativeId === initiative.id &&
                                        dropIndicator.position === "before"
                                          ? "ring-2 ring-inset ring-[#8fb3d9] before:absolute before:left-2 before:right-2 before:top-0 before:h-[3px] before:rounded-full before:bg-[#00bda5] before:content-['']"
                                          : ""
                                      } ${
                                        dropIndicator?.status === emptyStatus &&
                                        dropIndicator.initiativeId === initiative.id &&
                                        dropIndicator.position === "after"
                                          ? "ring-2 ring-inset ring-[#8fb3d9] after:absolute after:left-2 after:right-2 after:bottom-0 after:h-[3px] after:rounded-full after:bg-[#00bda5] after:content-['']"
                                          : ""
                                      }`}
                                    >
                                      <div className="min-w-0">
                                        <div className="min-w-0">
                                          <h4 className="pr-3 text-[12px] font-bold leading-[1.35] text-[#33475b]">
                                            {initiative.title}
                                          </h4>
                                          <p className="mt-1.5 line-clamp-3 text-[11px] leading-[1.45] text-[#516f90]">
                                            {getPlainInitiativeDescription(initiative.description)}
                                          </p>
                                          {initiative.status === "backlog" ? (
                                            <div className="mt-2 flex flex-wrap gap-1.5">
                                              {(["reviewing", "validated"] as const).map((validationStatus) => {
                                                const isSelected = initiative.validationStatus === validationStatus;
                                                const meta = EVALUATION_VALIDATION_META[validationStatus];

                                                return (
                                                  <span
                                                    key={validationStatus}
                                                    role="button"
                                                    tabIndex={0}
                                                    onClick={(event) => {
                                                      event.preventDefault();
                                                      event.stopPropagation();
                                                      updateEvaluationValidationStatus(
                                                        initiative.id,
                                                        validationStatus,
                                                      );
                                                    }}
                                                    onKeyDown={(event) => {
                                                      if (event.key !== "Enter" && event.key !== " ") return;
                                                      event.preventDefault();
                                                      event.stopPropagation();
                                                      updateEvaluationValidationStatus(
                                                        initiative.id,
                                                        validationStatus,
                                                      );
                                                    }}
                                                    className={`rounded-[3px] border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] transition ${
                                                      isSelected
                                                        ? meta.className
                                                        : "border-[#dfe3eb] bg-white text-[#516f90] hover:border-[#8fb3d9] hover:bg-[#f8fbff]"
                                                    }`}
                                                  >
                                                    {meta.label}
                                                  </span>
                                                );
                                              })}
                                            </div>
                                          ) : null}
                                          <div className="mt-2.5 flex min-h-[18px] w-full items-center rounded-[3px] border border-[#cbd6e2] bg-[#f5f8fa] px-2 text-[9px] font-bold leading-none text-[#33475b]">
                                            {formatDateRange(initiative.estStartDate || null, initiative.estEndDate || null)}
                                          </div>
                                        </div>
                                      </div>
                                      <div className="mt-3 flex items-center justify-between border-t border-[#eef2f7] pt-2.5">
                                        <span className="text-[10px] font-semibold text-[#9cb1c6]">
                                          {progress === 0 ? "0d inactivo" : `${progress}% avance`}
                                        </span>
                                        <div className="flex items-center gap-1.5">
                                          {initiative.commerciallyWaived ? (
                                            <span className="rounded-[3px] bg-[#dffaf5] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-[#007f70]">
                                              Bonificado
                                            </span>
                                          ) : null}
                                          <span
                                            className={`rounded-[3px] px-2 py-0.5 text-[10px] font-bold ${
                                              initiative.commerciallyWaived
                                                ? "bg-[#dffaf5] text-[#007f70]"
                                                : "bg-[#eef3f8] text-[#33475b]"
                                            }`}
                                          >
                                            {initiative.commerciallyWaived ? (
                                              <>
                                                <span className="mr-1 text-[#7faea7] line-through">
                                                  {originalCredits} CR
                                                </span>
                                                {credits} CR
                                              </>
                                            ) : (
                                              `${credits} CR`
                                            )}
                                          </span>
                                        </div>
                                      </div>
                                    </button>
                                  );
                                })
                              ) : (
                                <div className="rounded-[4px] border border-dashed border-[#cbd6e2] bg-[#f5f8fa] px-3 py-4 text-[10px] text-[#9cb1c6]">
                                  Vacio
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                }

                return (
                  <div
                    key={status}
                    className={`flex w-[320px] min-w-[320px] max-w-[340px] flex-col ${getMobileBoardStatusOrderClass(status)}`}
                  >
                    <div className="mb-2 flex items-center justify-between px-1">
                      <div className="flex items-center gap-2">
                        <span className={`h-2.5 w-2.5 rounded-full ${getStatusDot(status)}`} />
                        <p className={`text-[13px] font-bold uppercase tracking-[0.18em] ${getStatusHeadingClass(status)}`}>
                          {getStatusLabel(status)}
                        </p>
                      </div>
                      <span className="rounded-[2px] bg-[#eaf0f6] px-2 py-0.5 text-[11px] font-bold text-[#516f90]">
                        {totalCredits} CR
                      </span>
                    </div>

                    <div
                      className={`min-h-[360px] flex-1 space-y-2.5 rounded-[6px] px-1 pt-1 transition ${
                        dropTargetStatus === status
                          ? "bg-[#eef6ff] ring-1 ring-inset ring-[#bfd4ec]"
                          : ""
                      }`}
                      onDragOver={(event) => {
                        const draggedInitiative = proposal.initiatives.find(
                          (item) => item.id === draggedInitiativeId,
                        );

                        if (
                          !draggedInitiative ||
                          !canDropSalesInitiativeIntoStatus(draggedInitiative.status, status)
                        ) {
                          return;
                        }

                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        setDropTargetStatus(status);
                        setDropIndicator({ status, initiativeId: null, position: "after" });
                      }}
                      onDragLeave={(event) => {
                        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                        setDropTargetStatus((current) => (current === status ? null : current));
                        setDropIndicator((current) =>
                          current?.status === status && current.initiativeId === null ? null : current,
                        );
                      }}
                      onDrop={(event) => {
                        event.preventDefault();

                        const initiativeId =
                          event.dataTransfer.getData("text/plain") || draggedInitiativeId;
                        const initiative = proposal.initiatives.find((item) => item.id === initiativeId);

                        if (!initiative) {
                          setDraggedInitiativeId(null);
                          setDropTargetStatus(null);
                          setDropIndicator(null);
                          return;
                        }

                        moveInitiativeToStatus(initiative, status);
                      }}
                    >
                      {items.map((initiative) => {
                        const credits = calculateSalesInitiativeCredits(initiative);
                        const originalCredits = calculateSalesInitiativeOriginalCredits(initiative);
                        const progress = calculateSalesInitiativeProgress(initiative);
                        const isDraggable = true;

                        return (
                          <button
                            key={initiative.id}
                            type="button"
                            onClick={() => openInitiativeEditor(initiative)}
                            draggable={isDraggable}
                            onDragStart={(event) => {
                              if (!isDraggable) {
                                event.preventDefault();
                                return;
                              }

                              event.dataTransfer.setData("text/plain", initiative.id);
                              event.dataTransfer.effectAllowed = "move";
                              setDraggedInitiativeId(initiative.id);
                            }}
                            onDragOver={(event) => {
                              if (draggedInitiativeId === initiative.id) return;
                              const draggedInitiative = proposal.initiatives.find(
                                (item) => item.id === draggedInitiativeId,
                              );

                              if (
                                !draggedInitiative ||
                                !canDropSalesInitiativeIntoStatus(draggedInitiative.status, status)
                              ) {
                                return;
                              }

                              event.preventDefault();
                              event.stopPropagation();
                              event.dataTransfer.dropEffect = "move";
                              setDropTargetStatus(status);
                              setDropIndicator({
                                status,
                                initiativeId: initiative.id,
                                position: getDropPosition(event),
                              });
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              event.stopPropagation();

                              const initiativeId =
                                event.dataTransfer.getData("text/plain") || draggedInitiativeId;
                              const draggedInitiative = proposal.initiatives.find(
                                (item) => item.id === initiativeId,
                              );

                              if (!draggedInitiative) {
                                setDraggedInitiativeId(null);
                                setDropTargetStatus(null);
                                setDropIndicator(null);
                                return;
                              }

                              moveInitiativeToStatus(draggedInitiative, status, {
                                targetInitiativeId: initiative.id,
                                position: getDropPosition(event),
                              });
                            }}
                            onDragEnd={() => {
                              setDraggedInitiativeId(null);
                              setDropTargetStatus(null);
                              setDropIndicator(null);
                            }}
                            className={`relative w-full rounded-[7px] border px-3.5 py-3.5 text-left shadow-[0_1px_3px_rgba(51,71,91,0.07)] transition hover:-translate-y-[1px] hover:border-[#cbd6e2] hover:shadow-[0_8px_24px_rgba(51,71,91,0.08)] ${
                              initiative.commerciallyWaived
                                ? "border-[#9ee7db] bg-[#f0fffc]"
                                : "border-[#d8e2ec] bg-white"
                            } ${
                              isDraggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
                            } ${
                              dropIndicator?.status === status &&
                              dropIndicator.initiativeId === initiative.id &&
                              dropIndicator.position === "before"
                                ? "ring-2 ring-inset ring-[#8fb3d9] before:absolute before:left-2 before:right-2 before:top-0 before:h-[3px] before:rounded-full before:bg-[#00bda5] before:content-['']"
                                : ""
                            } ${
                              dropIndicator?.status === status &&
                              dropIndicator.initiativeId === initiative.id &&
                              dropIndicator.position === "after"
                                ? "ring-2 ring-inset ring-[#8fb3d9] after:absolute after:left-2 after:right-2 after:bottom-0 after:h-[3px] after:rounded-full after:bg-[#00bda5] after:content-['']"
                                : ""
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="min-w-0">
                                <h4 className="pr-3 text-[12px] font-bold leading-[1.35] text-[#33475b]">{initiative.title}</h4>
                                <p className="mt-1.5 line-clamp-3 text-[11px] leading-[1.45] text-[#516f90]">
                                  {getPlainInitiativeDescription(initiative.description, "Sin descripción ejecutiva.")}
                                </p>
                                {initiative.status === "backlog" ? (
                                  <div className="mt-2 flex flex-wrap gap-1.5">
                                    {(["reviewing", "validated"] as const).map((validationStatus) => {
                                      const isSelected = initiative.validationStatus === validationStatus;
                                      const meta = EVALUATION_VALIDATION_META[validationStatus];

                                      return (
                                        <span
                                          key={validationStatus}
                                          role="button"
                                          tabIndex={0}
                                          onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            updateEvaluationValidationStatus(
                                              initiative.id,
                                              validationStatus,
                                            );
                                          }}
                                          onKeyDown={(event) => {
                                            if (event.key !== "Enter" && event.key !== " ") return;
                                            event.preventDefault();
                                            event.stopPropagation();
                                            updateEvaluationValidationStatus(
                                              initiative.id,
                                              validationStatus,
                                            );
                                          }}
                                          className={`rounded-[3px] border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] transition ${
                                            isSelected
                                              ? meta.className
                                              : "border-[#dfe3eb] bg-white text-[#516f90] hover:border-[#8fb3d9] hover:bg-[#f8fbff]"
                                          }`}
                                        >
                                          {meta.label}
                                        </span>
                                      );
                                    })}
                                  </div>
                                ) : null}
                                <div className="mt-2.5 flex min-h-[18px] w-full items-center rounded-[3px] border border-[#cbd6e2] bg-[#f5f8fa] px-2 text-[9px] font-bold leading-none text-[#33475b]">
                                  {formatDateRange(initiative.estStartDate || null, initiative.estEndDate || null)}
                                </div>
                              </div>
                            </div>
                            <div className="mt-3 flex items-center justify-between border-t border-[#eef2f7] pt-2.5">
                              <span className="text-[10px] font-semibold text-[#9cb1c6]">
                                {progress === 0 ? "0d inactivo" : `${progress}% avance`}
                              </span>
                              <div className="flex items-center gap-1.5">
                                {initiative.commerciallyWaived ? (
                                  <span className="rounded-[3px] bg-[#dffaf5] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-[#007f70]">
                                    Bonificado
                                  </span>
                                ) : null}
                                <span
                                  className={`rounded-[3px] px-2 py-0.5 text-[10px] font-bold ${
                                    initiative.commerciallyWaived
                                      ? "bg-[#dffaf5] text-[#007f70]"
                                      : "bg-[#eef3f8] text-[#33475b]"
                                  }`}
                                >
                                  {initiative.commerciallyWaived ? (
                                    <>
                                      <span className="mr-1 text-[#7faea7] line-through">
                                        {originalCredits} CR
                                      </span>
                                      {credits} CR
                                    </>
                                  ) : (
                                    `${credits} CR`
                                  )}
                                </span>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                      {isDinterwebVariant && canManageSalesStage(status) ? (
                        <div className="mx-1">{renderDinterwebStageComposer(status)}</div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {hasPlanningItems ? (
            <div className="mt-6 w-[664px] min-w-[664px]">
              <button
                type="button"
                onClick={() => openCatalogModal(isDinterwebVariant ? defaultCatalogLibraryTab : undefined)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-[4px] border-2 border-dashed border-[#14b8a6] bg-[#f5fffd] px-6 py-4 text-[16px] font-bold text-[#00bda5] transition hover:bg-[#ecfffb]"
              >
                <Plus className="h-5 w-5" />
                Agregar Caso de Uso
              </button>
            </div>
          ) : !isProposalCheckoutLocked ? (
            <div className="mt-6 w-[664px] min-w-[664px] rounded-[8px] border border-[#8ee1d5] bg-[#e8fffb] p-4 shadow-[0_8px_24px_rgba(0,189,165,0.14)]">
              <button
                type="button"
                onClick={() => openCatalogModal(defaultCatalogLibraryTab)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-[6px] bg-[#14b8a6] px-8 py-3.5 text-[14px] font-extrabold text-white shadow-md transition hover:-translate-y-0.5 hover:bg-[#0ea899]"
              >
                <Plus className="h-4 w-4" />
                <span>Agregar casos de uso</span>
              </button>
            </div>
          ) : null}
        </section>

        <section className="bg-white px-6 py-10">
          <div className="mx-auto max-w-[1400px]">
          <div className="mb-8 border-b border-[#dfe3eb] pb-4">
            <h2 className="flex items-center gap-2 text-[20px] font-bold tracking-tight text-[#33475b]">
              <CalendarDays className="h-5 w-5 text-[#00bda5]" />
              Plan de Trabajo
            </h2>
            <p className="mt-2 text-[13px] text-[#516f90]">
              Proyección estratégica inicial. El cronograma definitivo se alineará con las prioridades exactas de tu equipo durante la sesión de Kickoff.
            </p>
          </div>

          <div className="mt-6 overflow-x-auto pb-2">
            <div className="min-w-[1160px] overflow-hidden rounded-[6px] border border-[#dfe3eb] bg-white shadow-sm">
              <div
                className="grid min-w-[1120px]"
                style={{
                  gridTemplateColumns: `0px minmax(${timelineRows.timelineDays * timelineRows.dayWidth}px, 1fr)`,
                }}
              >
                <div className="overflow-hidden border-r-0 bg-white" />
                <div className="overflow-hidden border-b border-[#dfe3eb] bg-[#f5f8fa]">
                  <div
                    className="grid"
                    style={{
                      gridTemplateColumns: `repeat(${timelineRows.timelineDays}, ${timelineRows.dayWidth}px)`,
                    }}
                  >
                    {timelineRows.monthSegments.map((month) => (
                      <div
                        key={month.key}
                        style={{ gridColumn: `span ${month.days} / span ${month.days}` }}
                        className="border-r border-[#dfe3eb] px-3 py-2 text-[11px] font-bold capitalize text-[#516f90] last:border-r-0"
                      >
                        {month.label}
                      </div>
                    ))}
                  </div>
                  <div
                    className="grid border-t border-[#dfe3eb] bg-white"
                    style={{
                      gridTemplateColumns: `repeat(${timelineRows.timelineDays}, ${timelineRows.dayWidth}px)`,
                    }}
                  >
                    {timelineRows.dayMarkers.map((marker) => (
                      <div
                        key={marker.key}
                        className="grid h-[24px] place-items-center border-r border-[#eef2f7] text-[8px] font-medium text-[#8aa0b4] last:border-r-0"
                      >
                        {marker.label}
                      </div>
                    ))}
                  </div>
                </div>

                {timelineRows.rows.length === 0 ? (
                  <>
                    <div className="border-r border-[#dfe3eb] px-3 py-4 text-[11px] text-[#9cb1c6]">
                      Sin rango
                    </div>
                    <div className="grid place-items-center border border-[#dfe3eb] border-l-0 px-4 py-10 text-center">
                      <p className="text-[12px] font-semibold text-[#516f90]">
                        Agrega fechas estimadas a las iniciativas para ver el cronograma comercial.
                      </p>
                    </div>
                  </>
                ) : (
                  timelineRows.rows.map((row) => {
                    const baseStart = row.initiative.estStartDate ?? toIsoDate(row.start as Date);
                    const baseEnd = row.initiative.estEndDate ?? toIsoDate(row.end as Date);
                    const dragDelta =
                      ganttDrag?.initiativeId === row.initiative.id ? ganttDrag.dayDelta : 0;
                    const baseStartDate = parseCalendarDate(baseStart);
                    const baseEndDate = parseCalendarDate(baseEnd);
                    const previewStartDate =
                      ganttDrag?.initiativeId === row.initiative.id && ganttDrag.mode === "resize-start"
                        ? (() => {
                            const candidate = addCalendarDays(baseStartDate, dragDelta);
                            return candidate > baseEndDate ? baseEndDate : candidate;
                          })()
                        : ganttDrag?.initiativeId === row.initiative.id && ganttDrag.mode === "resize-end"
                          ? baseStartDate
                          : addCalendarDays(baseStartDate, dragDelta);
                    const previewEndDate =
                      ganttDrag?.initiativeId === row.initiative.id && ganttDrag.mode === "resize-start"
                        ? baseEndDate
                        : ganttDrag?.initiativeId === row.initiative.id && ganttDrag.mode === "resize-end"
                          ? (() => {
                              const candidate = addCalendarDays(baseEndDate, dragDelta);
                              return candidate < baseStartDate ? baseStartDate : candidate;
                            })()
                          : addCalendarDays(baseEndDate, dragDelta);
                    const previewStartOffset = Math.max(
                      diffCalendarDays(timelineRows.windowStart, previewStartDate),
                      0,
                    );
                    const previewSpan = Math.max(
                      diffCalendarDays(previewStartDate, previewEndDate) + 1,
                      1,
                    );

                    return (
                      <Fragment key={row.initiative.id}>
                        <div className="h-[30px] w-0 overflow-hidden border-b border-transparent" />
                        <div className="relative border border-[#eaf0f6] border-l-0 border-t-0 bg-white">
                          <div
                            className="grid"
                            style={{
                              gridTemplateColumns: `repeat(${timelineRows.timelineDays}, ${timelineRows.dayWidth}px)`,
                            }}
                          >
                            {timelineRows.dayMarkers.map((marker) => (
                              <div
                                key={`${row.initiative.id}-${marker.key}`}
                                className="h-[30px] border-r border-b border-[#eef2f7] last:border-r-0"
                              />
                            ))}
                          </div>
                          {!row.isOutsideRange ? (
                            <div
                              className={`absolute top-[4px] h-[22px] rounded-[3px] ${getSalesTimelineBarClass(
                                row.initiative.status,
                              )}`}
                              style={{
                                left: `${previewStartOffset * timelineRows.dayWidth}px`,
                                width: `${Math.max(previewSpan * timelineRows.dayWidth - 4, timelineRows.dayWidth * 6)}px`,
                                opacity: ganttDrag?.initiativeId === row.initiative.id ? 0.92 : 1,
                              }}
                            >
                              <div
                                onPointerDown={(event) => {
                                  if (isSavingTimelineDates || row.initiative.isBlocked) return;
                                  event.preventDefault();
                                  setGanttDrag({
                                    initiativeId: row.initiative.id,
                                    originX: event.clientX,
                                    dayDelta: 0,
                                    startDate: baseStart,
                                    endDate: baseEnd,
                                    mode: "move",
                                  });
                                }}
                                onDoubleClick={() => openInitiativeEditor(row.initiative)}
                                className="absolute inset-y-0 left-3 right-3 z-0 flex cursor-grab items-center justify-center rounded-[3px] px-1 text-center active:cursor-grabbing"
                                title="Arrastra para mover fechas. Doble clic para editar."
                              >
                                <span className="truncate text-[8px] font-semibold leading-none">{row.initiative.title}</span>
                              </div>
                              <button
                                type="button"
                                aria-label="Ajustar fecha de inicio"
                                onPointerDown={(event) => {
                                  event.stopPropagation();
                                  event.preventDefault();
                                  if (isSavingTimelineDates) return;
                                  if (row.initiative.isBlocked) {
                                    setFeedback({
                                      tone: "error",
                                      message: "Esta iniciativa esta bloqueada. Debes desbloquearla antes de ajustar sus fechas.",
                                    });
                                    return;
                                  }
                                  setGanttDrag({
                                    initiativeId: row.initiative.id,
                                    originX: event.clientX,
                                    dayDelta: 0,
                                    startDate: baseStart,
                                    endDate: baseEnd,
                                    mode: "resize-start",
                                  });
                                }}
                                className="absolute left-0 top-0 z-20 h-full w-3 cursor-ew-resize rounded-l-[3px] bg-transparent"
                                title="Arrastra para cambiar el inicio"
                              >
                                <span className="absolute left-1 top-1/2 h-3 w-1 -translate-y-1/2 rounded-full bg-white/90 shadow-[0_0_0_1px_rgba(255,255,255,0.25)]" />
                              </button>
                              <button
                                type="button"
                                aria-label="Ajustar fecha de fin"
                                onPointerDown={(event) => {
                                  event.stopPropagation();
                                  event.preventDefault();
                                  if (isSavingTimelineDates) return;
                                  if (row.initiative.isBlocked) {
                                    setFeedback({
                                      tone: "error",
                                      message: "Esta iniciativa esta bloqueada. Debes desbloquearla antes de ajustar sus fechas.",
                                    });
                                    return;
                                  }
                                  setGanttDrag({
                                    initiativeId: row.initiative.id,
                                    originX: event.clientX,
                                    dayDelta: 0,
                                    startDate: baseStart,
                                    endDate: baseEnd,
                                    mode: "resize-end",
                                  });
                                }}
                                className="absolute right-0 top-0 z-20 h-full w-3 cursor-ew-resize rounded-r-[3px] bg-transparent"
                                title="Arrastra para cambiar el fin"
                              >
                                <span className="absolute right-1 top-1/2 h-3 w-1 -translate-y-1/2 rounded-full bg-white/90 shadow-[0_0_0_1px_rgba(255,255,255,0.25)]" />
                              </button>
                            </div>
                          ) : (
                            <div className="absolute inset-0 grid place-items-center px-4 text-center">
                              <p className="text-[10px] font-semibold text-[#8aa0b4]">
                                Fuera de la ventana visible.
                              </p>
                            </div>
                          )}
                        </div>
                      </Fragment>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {false ? (
            <div className="mt-6 rounded-[6px] border border-dashed border-[#cbd6e2] bg-[#f8fbfd] px-4 py-4">
              <div className="flex items-center justify-between">
                <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#516f90]">
                  Iniciativas sin rango
                </h3>
                <span className="rounded-full bg-[#f5f8fa] px-3 py-1 text-[10px] font-bold text-[#516f90]">
                  {timelineRows.undatedRows.length} pendientes
                </span>
              </div>
              <p className="mt-2 text-[12px] text-[#8aa0b4]">
                Aún no entran al calendario porque les falta fecha de inicio o fin.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                {timelineRows.undatedRows.map((initiative) => (
                  <button
                    key={initiative.id}
                    type="button"
                    onClick={() => openInitiativeEditor(initiative)}
                    className="rounded-full border border-[#d7e0ea] bg-white px-4 py-2 text-[11px] text-[#33475b] shadow-[0_1px_2px_rgba(51,71,91,0.05)]"
                  >
                    <span className="font-bold">{initiative.title}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          </div>
        </section>

        <section className="bg-white px-6 pb-10">
          <div className="mx-auto max-w-[1400px]">
          <div className="border-b border-[#dfe3eb] pb-4">
          <h2 className="text-[14px] font-bold text-[#33475b]">Desglose Analítico por Etapa</h2>
          </div>
          <div className="mt-7 space-y-4">
            {summaryStatuses.map((status) => {
              const items = groupedInitiatives[status];
              if (!items.length) return null;

              return (
                <div key={`summary-${status}`} className="overflow-hidden rounded-[6px] border border-[#dfe3eb] bg-white shadow-sm">
                  <div className="flex items-center justify-between border-b border-[#dfe3eb] bg-white px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${getStatusDot(status)}`} />
                      <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-[#33475b]">
                        {getStatusLabel(status)}
                      </p>
                    </div>
                    <span className="rounded-[3px] border border-[#cbd6e2] bg-white px-2 py-1 text-[10px] font-bold text-[#33475b]">
                      {items.reduce((sum, initiative) => sum + calculateSalesInitiativeCredits(initiative), 0)} CR
                    </span>
                  </div>
                  <div className="divide-y divide-[#eef2f7]">
                    {items.map((initiative) => {
                      const summaryCatalogGroup = findCatalogGroupForInitiative(initiative, catalogGroups);
                      const summaryFields = [
                        {
                          label: "Alcance y descripcion detallada",
                          value: initiative.description || summaryCatalogGroup?.description || "",
                          fallback: "Sin descripcion detallada.",
                        },
                        {
                          label: "Responsabilidades del cliente",
                          value: summaryCatalogGroup?.completionOutcome || "",
                          fallback: "Sin resultado definido.",
                        },
                        {
                          label: "Criterio de Éxito",
                          value: summaryCatalogGroup?.successMilestone || "",
                          fallback: "Sin criterio definido.",
                        },
                      ];

                      return (
                      <div
                        key={`summary-card-${initiative.id}`}
                        className="w-full px-5 py-5 text-left"
                      >
                        <div>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <h4 className="text-[14px] font-bold text-[#33475b]">{initiative.title}</h4>
                              <p className="hidden">
                                {getPlainInitiativeDescription(initiative.description, "Sin descripción ejecutiva.")}
                              </p>
                              <div className="mt-2 inline-flex rounded-[3px] border border-[#cbd6e2] bg-[#f5f8fa] px-2 py-0.5 text-[9px] font-bold text-[#33475b]">
                                {formatDateRange(initiative.estStartDate || null, initiative.estEndDate || null)}
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="mt-4 grid gap-3 lg:grid-cols-3">
                          {summaryFields.map((field) => (
                            <div key={`${initiative.id}-${field.label}`} className="rounded-[4px] border border-[#dfe3eb] bg-white p-3">
                              <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#516f90]">
                                {field.label}
                              </p>
                              <div className="mt-2 border-t border-[#dfe3eb] pt-3">
                                <RichTextDisplay
                                  value={field.value}
                                  fallback={field.fallback}
                                  className="text-[11px] leading-5 text-[#516f90]"
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          </div>
        </section>
      </main>

      <PlanReportExportPages
        rootId="sales-plan-report-export-root"
        pageIdPrefix="sales-plan-report"
        reportLabel={proposal.workspaceVariant === "dinterweb" ? "Dinterweb Propuesta" : "HubSpot Propuesta"}
        clientName={proposal.clientName || proposal.clientCompany || proposal.title || "Prospecto"}
        description={proposal.clientDescription || "Plan comercial detallado para el prospecto."}
        startDateLabel={formatDateRange(proposal.startDate || null, proposal.startDate || null)}
        stageLabel="Vista vendedor"
        metrics={{
          available: metrics.available,
          committed: metrics.committed,
          completed: metrics.completed,
          total: metrics.total,
          priceLabel: formatCurrency(proposal.quotedPrice, proposal.currency.toUpperCase()),
          creditsLabel: `${proposal.contractedCredits} CR`,
          cadenceLabel: getPlanCadenceLabel(proposal.periodMonths),
        }}
        groupedInitiatives={reportGroupedInitiatives}
      />

      {isGeneratingWizardPlan ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#33475b]/72 p-6 backdrop-blur-sm">
          <div className="w-full max-w-[520px] rounded-[16px] border border-white/60 bg-white px-8 py-9 text-center shadow-[0_24px_70px_rgba(15,23,42,0.28)]">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#ecfffb] text-[#14b8a6] shadow-[0_10px_30px_rgba(20,184,166,0.18)]">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>

            <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.22em] text-[#8aa0b4]">
              Guia de Activacion
            </p>
            <h3 className="mt-2 text-[24px] font-extrabold tracking-[-0.02em] text-[#33475b]">
              Armando tu Plan de Trabajo
            </h3>
            <p className="mt-3 text-[15px] font-semibold text-[#14b8a6]">
              {wizardLoadingMessage}
            </p>
            <p className="mt-2 text-[12px] leading-6 text-[#516f90]">
              Estamos organizando una recomendacion alineada al contexto y a los creditos disponibles.
            </p>

            <div className="mt-6 grid gap-2 text-left">
              {WIZARD_LOADING_MESSAGES.map((message, index) => {
                const isActive = index === wizardLoadingMessageIndex;
                const isCompleted = index < wizardLoadingMessageIndex;

                return (
                  <div
                    key={message}
                    className={`flex items-center gap-3 rounded-[10px] px-4 py-3 transition ${
                      isActive
                        ? "bg-[#ecfffb] text-[#0f766e]"
                        : isCompleted
                          ? "bg-[#f5f8fa] text-[#516f90]"
                          : "bg-[#fbfcfe] text-[#9cb1c6]"
                    }`}
                  >
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${
                        isActive ? "bg-[#14b8a6]" : isCompleted ? "bg-[#7dd3c7]" : "bg-[#d8e2ec]"
                      }`}
                    />
                    <span className="text-[12px] font-bold">{message}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {isCatalogModalOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#33475b]/80 p-4 backdrop-blur-sm md:p-8">
          <div className="flex h-[90vh] w-full max-w-[1380px] flex-col overflow-hidden rounded-[8px] bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#dfe3eb] bg-[#f5f8fa] px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded bg-[#00bda5]/10 text-[#00bda5]">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-[18px] font-bold text-[#33475b]">Catálogo de Casos de Uso</h2>
                  <p className="text-[12px] text-[#516f90]">
                    Haz clic en un caso para ver los detalles y definir su inclusión en tu estrategia.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={closeCatalogModal}
                className="rounded-[4px] bg-[#33475b] px-5 py-2 text-[13px] font-bold text-white transition hover:bg-[#243444]"
              >
                Terminar y Cerrar
              </button>
            </div>

            <div className="flex min-h-0 flex-1 overflow-hidden">
              <aside className="w-[250px] shrink-0 overflow-y-auto border-r border-[#dfe3eb] bg-[#fcfcfc] p-3">
                <div className="space-y-1.5">
                  {catalogTabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveCatalogTab(tab.id)}
                      className={`flex w-full items-center gap-2 rounded-[6px] px-4 py-3 text-left text-[13px] font-bold transition ${
                        activeCatalogTab === tab.id
                          ? "bg-[#14b8a6] text-white shadow-sm"
                          : "text-[#516f90] hover:bg-white"
                      }`}
                    >
                      {tab.id === "wizard" ? (
                        <Sparkles className="h-4 w-4 shrink-0" />
                      ) : (
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                            activeCatalogTab === tab.id ? "bg-white" : "bg-current opacity-45"
                          }`}
                        />
                      )}
                      {tab.label}
                    </button>
                  ))}
                </div>
              </aside>

              <div ref={catalogContentRef} className="min-h-0 flex-1 overflow-y-auto bg-[#f5f8fa] p-6">
                {activeCatalogTab === "wizard" ? (
                  <div className="relative mx-auto flex max-w-[770px] flex-col rounded-[8px] border border-[#dfe3eb] bg-white p-8 shadow-sm">
                    <div className="text-center">
                      <h3 className="text-[24px] font-extrabold text-[#33475b]">Veamos qué activar primero</h3>
                      <p className="mt-2 text-[14px] text-[#516f90]">
                        Responde 3 preguntas y armamos contigo los casos de uso para empezar.
                      </p>
                    </div>

                    <div className="mt-10 space-y-8">
                      <div>
                        <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-[#516f90]">
                          1. ¿Qué áreas de HubSpot deseas activar?
                        </p>
                        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
                          {wizardOptionLabels.map((hub) => {
                            const selectedIndex = wizardHubs.indexOf(hub);
                            const isSelected = selectedIndex !== -1;

                            return (
                              <button
                                key={hub}
                                type="button"
                                onClick={() => toggleWizardHub(hub)}
                                className={`relative rounded-[8px] border-2 px-4 py-5 text-[14px] font-bold transition ${
                                  isSelected
                                    ? "border-[#14b8a6] bg-[#ecfffb] text-[#14b8a6]"
                                    : "border-[#cbd6e2] bg-white text-[#516f90] hover:border-[#9cb1c6]"
                                }`}
                              >
                                {isSelected ? (
                                  <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-[#14b8a6] text-[11px] font-extrabold text-white">
                                    {selectedIndex + 1}
                                  </span>
                                ) : null}
                                {hub}
                              </button>
                            );
                          })}
                        </div>
                        <p className="mt-3 text-[10px] italic text-[#8aa0b4]">
                          * El orden de selección define tu prioridad de implementación.
                        </p>
                      </div>

                      <div>
                        <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-[#516f90]">
                          2. ¿Cuál es el estado actual de tu portal?
                        </p>
                        <div className="mt-4 grid gap-4 md:grid-cols-2">
                          <button
                            type="button"
                            onClick={() => setWizardPortalState("new")}
                            className={`rounded-[8px] border-2 p-5 text-left transition ${
                              wizardPortalState === "new"
                                ? "border-[#14b8a6] bg-[#ecfffb]"
                                : "border-[#cbd6e2] bg-white hover:border-[#9cb1c6]"
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <span className={`mt-1 h-4 w-4 rounded-full ${wizardPortalState === "new" ? "bg-[#14b8a6]" : "bg-[#d5e0eb]"}`} />
                              <div>
                                <p className="text-[13px] font-bold text-[#33475b]">Estamos empezando desde cero</p>
                                <p className="mt-1 text-[11px] text-[#516f90]">
                                  Portal nuevo o sin uso real previo.
                                </p>
                              </div>
                            </div>
                          </button>

                          <button
                            type="button"
                            onClick={() => setWizardPortalState("optimize")}
                            className={`rounded-[8px] border-2 p-5 text-left transition ${
                              wizardPortalState === "optimize"
                                ? "border-[#14b8a6] bg-[#ecfffb]"
                                : "border-[#cbd6e2] bg-white hover:border-[#9cb1c6]"
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <span className={`mt-1 h-4 w-4 rounded-full ${wizardPortalState === "optimize" ? "bg-[#14b8a6]" : "bg-[#d5e0eb]"}`} />
                              <div>
                                <p className="text-[13px] font-bold text-[#33475b]">
                                  Ya usamos HubSpot pero necesitamos ordenarlo
                                </p>
                                <p className="mt-1 text-[11px] text-[#516f90]">
                                  Tenemos datos, pero buscamos mejores prácticas.
                                </p>
                              </div>
                            </div>
                          </button>
                        </div>
                      </div>

                      <div>
                        <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-[#516f90]">
                          3. Si tuvieras que elegir un único reto principal, ¿cuál sería?
                        </p>
                        <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-[#516f90]">
                          Agrega aqui cualquier contexto adicional para orientar mejor la propuesta.
                        </p>
                        <div className="mt-4">
                          <textarea
                            rows={5}
                            value={wizardContext}
                            onChange={(event) => setWizardContext(event.target.value)}
                            placeholder="Ejemplo: Ya se está usando HubSpot Sales, tiene problemas con la calidad de datos, quiere ordenar su pipeline y necesita una propuesta alineada a un equipo comercial de 8 personas."
                            className="w-full rounded-[8px] border-2 border-[#cbd6e2] bg-white px-4 py-3 text-[13px] text-[#33475b] outline-none transition placeholder:text-[#9cb1c6] focus:border-[#14b8a6]"
                          />
                          <p className="hidden mt-2 text-[11px] text-[#7c98b6]">
                            Comparte aqui cualquier contexto adicional que le ayude al equipo a entender mejor el escenario del cliente.
                          </p>
                        </div>
                        <div className="hidden">
                          {(wizardChallenges[wizardHubs[0] as keyof typeof wizardChallenges] ?? []).map((challenge) => (
                            <button
                              key={challenge.id}
                              type="button"
                              onClick={() => setWizardChallenge(challenge.id)}
                              className={`w-full rounded-[8px] border-2 p-5 text-left transition ${
                                wizardChallenge === challenge.id
                                  ? "border-[#14b8a6] bg-[#ecfffb]"
                                  : "border-[#cbd6e2] bg-white hover:border-[#9cb1c6]"
                              }`}
                            >
                              <div className="flex items-start gap-3">
                                <span className={`mt-1 h-4 w-4 rounded-full ${wizardChallenge === challenge.id ? "bg-[#14b8a6]" : "bg-[#d5e0eb]"}`} />
                                <div>
                                  <p className="text-[13px] font-bold text-[#33475b]">{challenge.label}</p>
                                  <p className="mt-1 text-[11px] text-[#516f90]">{challenge.description}</p>
                                </div>
                              </div>
                            </button>
                          ))}

                          {!wizardHubs.length ? (
                            <div className="rounded-[8px] border-2 border-dashed border-[#cbd6e2] bg-[#fcfcfc] p-6 text-center text-[12px] font-medium text-[#9cb1c6]">
                              Selecciona primero un área de HubSpot para desbloquear los retos.
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="sticky bottom-0 -mx-8 mt-6 border-t border-[#dfe3eb] bg-white/95 px-8 pb-1 pt-4 backdrop-blur-sm">
                      <div className="flex justify-center">
                      <button
                        type="button"
                        onClick={applyWizardRecommendations}
                        disabled={!wizardHubs.length || isGeneratingWizardPlan}
                        className="inline-flex items-center gap-2 rounded-[6px] bg-[#14b8a6] px-10 py-3.5 text-[15px] font-bold text-white shadow-md transition hover:bg-[#0ea899] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Sparkles className="h-4 w-4" />
                        {isGeneratingWizardPlan ? "Cargando..." : "Armar Plan de Trabajo"}
                      </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-5">
                    <div className="rounded-[8px] border border-[#dfe3eb] bg-white px-5 py-4 shadow-sm">
                      <div className="flex flex-wrap items-center gap-3">
                        <label className="relative block flex-1 min-w-[200px]">
                          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8aa0b4]" />
                          <input
                            type="search"
                            value={catalogSearchQuery}
                            onChange={(event) => setCatalogSearchQuery(event.target.value)}
                            placeholder="Buscar grupo, caso de uso o tarea..."
                            className="h-11 w-full rounded-[8px] border border-[#cbd6e2] bg-[#fbfcfe] pl-11 pr-4 text-[13px] text-[#33475b] outline-none transition placeholder:text-[#9cb1c6] focus:border-[#14b8a6] focus:bg-white"
                          />
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {["Inmobiliaria", "Salud", "Ecommerce"].map((tag) => (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => setCatalogTagFilter((current) => (current === tag ? null : tag))}
                              className={`rounded-full px-3 py-1.5 text-[12px] font-semibold transition ${
                                catalogTagFilter === tag
                                  ? "bg-[#14b8a6] text-white"
                                  : "border border-[#14b8a6]/40 bg-[#f0fdfa] text-[#0e9488] hover:bg-[#ccfbf1]"
                              }`}
                            >
                              {tag}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {visibleCatalogGroups.length ? (
                      <div className="grid auto-rows-fr grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
                        {visibleCatalogGroups.map((group) => {
                      const alreadyAdded = isCatalogGroupAlreadyAdded(group);

                      return (
                        <div
                          key={group.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            openCatalogGroupPreview(group);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              openCatalogGroupPreview(group);
                            }
                          }}
                          className={`flex h-full min-h-[320px] flex-col rounded-[6px] border p-5 text-left shadow-sm transition ${
                            alreadyAdded
                              ? "cursor-pointer border-[#bfd9d4] bg-[#f8fffd] hover:-translate-y-[1px] hover:shadow-md"
                              : "cursor-pointer border-[#dfe3eb] bg-white hover:-translate-y-[1px] hover:shadow-md"
                          }`}
                        >
                          <div className="mb-3 flex flex-wrap gap-1.5">
                            <span
                              className={`rounded-[2px] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] ${
                                alreadyAdded
                                  ? "border border-[#d7dee8] bg-[#eef2f6] text-[#7c8da1]"
                                  : "border border-[#00bda5]/20 bg-[#f0fdfa] text-[#00bda5]"
                              }`}
                            >
                              {group.modalCategory}
                            </span>
                          </div>
                          <h4
                            className={`min-h-[44px] text-[14px] font-bold leading-snug ${
                              alreadyAdded ? "text-[#6b7d91]" : "text-[#33475b]"
                            }`}
                            style={{
                              display: "-webkit-box",
                              WebkitBoxOrient: "vertical",
                              WebkitLineClamp: 2,
                              overflow: "hidden",
                            }}
                          >
                            {group.name}
                          </h4>
                          <div className="mt-2 flex-1 overflow-hidden">
                            <p
                              className={`text-[11px] leading-relaxed ${
                                alreadyAdded ? "text-[#7c8da1]" : "text-[#516f90]"
                              }`}
                              style={{
                                display: "-webkit-box",
                                WebkitBoxOrient: "vertical",
                                WebkitLineClamp: 7,
                                overflow: "hidden",
                              }}
                            >
                              {getCatalogGroupPreview(group, "Grupo sugerido desde el catalogo para incluirlo dentro de la propuesta comercial.")}
                            </p>
                          </div>
                          <div className="mt-auto flex items-center justify-between border-t border-[#eaf0f6] pt-4">
                            <span className={`text-[14px] font-bold ${alreadyAdded ? "text-[#9aa9b9]" : "text-[#ff7a59]"}`}>
                              {group.credits} CR
                            </span>
                            <div className="flex items-center gap-3">
                              <span className={`text-[11px] font-bold ${alreadyAdded ? "text-[#9cb1c6]" : "text-[#00bda5]"}`}>
                                {alreadyAdded ? "Ya agregado" : "Disponible"}
                              </span>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openCatalogGroupPreview(group);
                                }}
                                className="rounded-[3px] border border-[#99f6e4] bg-[#f0fdfa] px-2.5 py-1 text-[10px] font-bold text-[#00bda5] transition hover:bg-[#ecfffb]"
                              >
                                Ver detalles
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                      </div>
                    ) : (
                      <div className="rounded-[8px] border border-dashed border-[#bfd9d4] bg-[#f8fffd] px-6 py-12 text-center shadow-sm">
                        <p className="text-[15px] font-bold text-[#33475b]">No encontramos grupos con esa busqueda.</p>
                        <p className="mt-2 text-[12px] text-[#7c98b6]">
                          Prueba con otra palabra clave o cambia de categoria.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>
      ) : null}

      {catalogPreviewGroup ? (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button
            type="button"
            className="flex-1 bg-transparent"
            onClick={closeCatalogGroupPreview}
            aria-label="Cerrar detalle del grupo"
          />
          <aside className="relative flex h-full w-full max-w-[500px] flex-col border-l border-[#dfe3eb] bg-white shadow-[-16px_0_40px_rgba(51,71,91,0.12)]">
            <div className="border-b border-[#dfe3eb] bg-white px-6 py-6">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <span className="inline-flex rounded-[3px] border border-[#99f6e4] bg-[#f0fdfa] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#00bda5]">
                    {catalogPreviewGroup.modalCategory}
                  </span>
                  <h3 className="mt-4 text-[22px] font-extrabold leading-[1.1] text-[#33475b]">
                    {catalogPreviewGroup.name}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={closeCatalogGroupPreview}
                  className="rounded-[2px] p-1 text-[#9cb1c6] hover:bg-white hover:text-[#33475b]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
              {catalogPreviewGroup.preview ? (
                <section>
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#9cb1c6]">
                    Preview
                  </p>
                  <div className="mt-3 rounded-[6px] border border-[#dfe3eb] bg-white p-5 shadow-sm">
                    <RichTextDisplay
                      value={catalogPreviewGroup.preview}
                      className="text-[13px] leading-relaxed text-[#33475b]"
                    />
                  </div>
                </section>
              ) : null}

              <section>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#9cb1c6]">
                  Alcance y descripcion detallada
                </p>
                <div className="mt-3 rounded-[6px] border border-[#dfe3eb] bg-white p-5 shadow-sm">
                  <RichTextDisplay
                    value={catalogPreviewGroup.description}
                    fallback="Este grupo no tiene descripcion detallada todavia."
                    className="text-[13px] leading-relaxed text-[#33475b]"
                  />
                </div>
              </section>

              {catalogPreviewGroup.completionOutcome ? (
                <section>
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#9cb1c6]">
                    Responsabilidades del cliente
                  </p>
                  <div className="mt-3 rounded-[6px] border border-[#dfe3eb] bg-white p-5 shadow-sm">
                    <RichTextDisplay
                      value={catalogPreviewGroup.completionOutcome}
                      className="text-[13px] leading-relaxed text-[#33475b]"
                    />
                  </div>
                </section>
              ) : null}

              {catalogPreviewGroup.successMilestone ? (
                <section>
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#9cb1c6]">
                    Criterio de Éxito
                  </p>
                  <div className="mt-3 rounded-[6px] border border-[#dfe3eb] bg-white p-5 shadow-sm">
                    <RichTextDisplay
                      value={catalogPreviewGroup.successMilestone}
                      className="text-[13px] leading-relaxed text-[#33475b]"
                    />
                  </div>
                </section>
              ) : null}

              <section className="rounded-[6px] border border-[#d9e6f2] bg-[#f8fbff] p-4 shadow-[0_8px_24px_rgba(81,111,144,0.08)]">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#9cb1c6]">
                  Tareas incluidas
                </p>
                <div className="mt-3 rounded-[6px] border border-[#dfe3eb] bg-[#fcfcfc] p-4">
                  {catalogPreviewGroup.items.length ? (
                    <ul className="space-y-2">
                      {catalogPreviewGroup.items.map((item) => (
                        <li key={`preview-${catalogPreviewGroup.id}-${item.id}`} className="rounded-[4px] border border-[#eaf0f6] bg-white px-3 py-2">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-[12px] font-bold leading-snug text-[#33475b]">
                                {item.label}
                              </p>
                              <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.12em] text-[#516f90]">
                                {item.category}
                              </p>
                            </div>
                            <span className="shrink-0 text-[11px] font-bold text-[#ff7a59]">
                              {item.credits} CR
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[12px] text-[#516f90]">
                      Este grupo no tiene tareas asociadas; usa una carga manual de creditos.
                    </p>
                  )}
                </div>
              </section>

              <section className="rounded-[6px] border border-[#99f6e4] bg-[#f0fdfa] px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[12px] font-bold uppercase tracking-[0.08em] text-[#00bda5]">
                    Consumo de creditos:
                  </p>
                  <p className="text-[28px] font-extrabold text-[#00bda5]">
                    {catalogPreviewGroup.credits} CR
                  </p>
                </div>
              </section>
            </div>

            <div className="border-t border-[#dfe3eb] bg-white px-5 py-5">
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => addCatalogPreviewGroup("planned")}
                  className="flex w-full flex-col items-center justify-center rounded-[6px] bg-[#14b8a6] px-5 py-4 text-white shadow-md transition hover:bg-[#0ea899]"
                >
                  <span className="text-[14px] font-extrabold">Incluir en Planificacion</span>
                  <span className="mt-1 text-[11px] font-medium opacity-90">
                    Consumira {catalogPreviewGroup.credits} CR
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => addCatalogPreviewGroup("backlog")}
                  className="flex w-full flex-col items-center justify-center rounded-[6px] bg-[#5f7ea2] px-5 py-4 text-white shadow-md transition hover:bg-[#4f6f92]"
                >
                  <span className="text-[14px] font-extrabold">Dejar en Evaluacion</span>
                  <span className="mt-1 text-[11px] font-medium opacity-90">
                    No consumira creditos por ahora
                  </span>
                </button>
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      {isUpsellModalOpen && isDinterwebVariant ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#33475b]/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-[640px] rounded-[6px] border border-[#dfe3eb] bg-white p-6 shadow-2xl">
            <div className="text-center">
              <h3 className="text-[18px] font-bold text-[#33475b]">Expandir paquete base</h3>
              <p className="mt-2 text-[13px] text-[#516f90]">
                El paquete inicia en 80 creditos por USD 1197. Desde aqui puedes redefinir los creditos y la inversion del plan, sin bajar de 60 creditos ni de USD 897.
              </p>
            </div>

            <div className="mt-6 rounded-[6px] border border-[#dfe3eb] bg-[#f8fbfd] p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[14px] font-bold text-[#33475b]">Minimo permitido</p>
                  <p className="mt-1 text-[12px] text-[#516f90]">
                    {DINTERWEB_MIN_PACKAGE.credits} CR por{" "}
                    {formatCurrency(DINTERWEB_MIN_PACKAGE.price, proposal.currency.toUpperCase())} al mes base.
                  </p>
                </div>
                <span className="rounded-[4px] border border-[#99f6e4] bg-[#f0fdfa] px-3 py-1 text-[11px] font-bold text-[#00bda5]">
                  Piso
                </span>
              </div>
            </div>

            <div className="mt-5 grid gap-3 rounded-[6px] border border-[#dfe3eb] bg-[#f8fbfd] p-4 sm:grid-cols-2">
              <label className="space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#516f90]">
                  Creditos del plan
                </span>
                <input
                  type="number"
                  min={String(DINTERWEB_MIN_PACKAGE.credits)}
                  value={dinterwebPlanCreditsDraft}
                  onChange={(event) => setDinterwebPlanCreditsDraft(event.target.value)}
                  className="h-10 w-full rounded-[4px] border border-[#cbd6e2] bg-white px-3 text-[13px] font-bold text-[#33475b] outline-none transition focus:border-[#00bda5]"
                />
              </label>
              <label className="space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#516f90]">
                  Inversion del plan
                </span>
                <input
                  type="number"
                  min={String(DINTERWEB_MIN_PACKAGE.price)}
                  value={dinterwebPlanPriceDraft}
                  onChange={(event) => setDinterwebPlanPriceDraft(event.target.value)}
                  className="h-10 w-full rounded-[4px] border border-[#cbd6e2] bg-white px-3 text-[13px] font-bold text-[#33475b] outline-none transition focus:border-[#00bda5]"
                />
              </label>
            </div>

            <div className="mt-5 rounded-[4px] border border-[#99f6e4] bg-[#f0fdfa] p-4">
              <div className="flex items-center justify-between gap-4 text-[14px] font-bold text-[#33475b]">
                <span>Total del plan</span>
                <span>
                  {Math.max(DINTERWEB_MIN_PACKAGE.credits, safeParseNumber(dinterwebPlanCreditsDraft))} CR
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between gap-4 text-[15px] font-extrabold">
                <span className="text-[#33475b]">Valor por periodo</span>
                <span className="text-[#ff7a59]">
                  {formatCurrency(
                    Math.max(DINTERWEB_MIN_PACKAGE.price, safeParseNumber(dinterwebPlanPriceDraft)),
                    proposal.currency.toUpperCase(),
                  )}
                </span>
              </div>
              {proposal.billingMode === "subscription" ? (
                <div className="mt-3 border-t border-[#99f6e4] pt-3 text-[12px] font-medium text-[#516f90]">
                  Se convertira en una suscripcion Stripe {proposal.periodMonths === 3 ? "trimestral" : proposal.periodMonths === 6 ? "semestral" : proposal.periodMonths === 12 ? "anual" : "mensual"}.
                </div>
              ) : null}
            </div>

            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={closeUpsellModal}
                className="inline-flex h-10 flex-1 items-center justify-center rounded-[4px] border border-[#dfe3eb] bg-white px-4 text-[13px] font-bold text-[#33475b] transition hover:bg-[#f5f8fa]"
              >
                Cancelar
              </button>
              {hasDinterwebCustomPackage ? (
                <button
                  type="button"
                  onClick={removeDinterwebCustomPackage}
                  className="inline-flex h-10 flex-1 items-center justify-center rounded-[4px] border border-[#fecaca] bg-[#fff1f2] px-4 text-[13px] font-bold text-[#be123c] transition hover:bg-[#ffe4e6]"
                >
                  Quitar ajuste
                </button>
              ) : null}
              <button
                type="button"
                onClick={confirmUpsell}
                className="inline-flex h-10 flex-1 items-center justify-center rounded-[4px] bg-[#ff7a59] px-4 text-[13px] font-bold text-white transition hover:bg-[#dc6548]"
              >
                Guardar paquete
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isUpsellModalOpen && !isDinterwebVariant ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#33475b]/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-[640px] rounded-[6px] border border-[#dfe3eb] bg-white p-6 shadow-2xl">
            <div className="text-center">
              <h3 className="text-[18px] font-bold text-[#33475b]">Incremento de Capacidad</h3>
              <p className="mt-2 text-[13px] text-[#516f90]">
                Añade paquetes adicionales de créditos a tu plan actual.
              </p>
            </div>

            <div className="mt-6 flex flex-col items-center gap-2">
              <div className="flex w-full max-w-[340px] items-center gap-3">
                <select
                  value={upsellPackageCredits}
                  onChange={(event) => setUpsellPackageCredits(safeParseNumber(event.target.value))}
                  className="h-9 flex-1 rounded-[2px] border border-[#cbd6e2] bg-white px-3 text-[13px] font-bold text-[#33475b] outline-none transition focus:border-[#00bda5]"
                >
                  {SALES_PROPOSAL_UPSELL_OPTIONS.map((option) => (
                    <option key={`upsell-${option.credits}`} value={option.credits}>
                      {option.credits} créditos
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={addUpsellPackage}
                  className="inline-flex h-9 items-center justify-center rounded-[4px] bg-[#14b8a6] px-5 text-[13px] font-bold text-white transition hover:bg-[#0ea899]"
                >
                  + Añadir
                </button>
              </div>
              <p className="text-[12px] text-[#516f90]">
                Valor por paquete: {formatCurrency(upsellPackagePrice, proposal.currency.toUpperCase())}
              </p>
            </div>

            <div className="mt-5 rounded-[4px] border border-[#99f6e4] bg-[#f0fdfa] p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#00bda5]">
                Resumen de inversion mensual
              </p>

              <div className="mt-4 space-y-3 text-[13px] text-[#33475b]">
                <div className="flex items-center justify-between gap-4">
                  <span className="font-bold">Plan base {SALES_PROPOSAL_BASE_CREDITS} CR:</span>
                  <span className="font-bold">
                    {formatCurrency(SALES_PROPOSAL_BASE_PRICE, proposal.currency.toUpperCase())}
                  </span>
                </div>

                {upsellCartCount > 0 ? (
                  <div className="flex items-center justify-between gap-4">
                    <button
                      type="button"
                      onClick={removeUpsellPackage}
                      className="mr-1 text-[16px] font-bold text-[#9cb1c6] transition hover:text-[#ef4444]"
                    >
                      ×
                    </button>
                    <span className="flex-1">
                      {upsellCartCount}x Paquete {upsellPackageCredits} CR{" "}
                      <span className="text-[11px] text-[#516f90]">
                        ({formatCurrency(upsellPackagePrice, proposal.currency.toUpperCase())} c/u)
                      </span>
                      :
                    </span>
                    <span className="font-bold">
                      {formatCurrency(
                        upsellPackagePrice * upsellCartCount,
                        proposal.currency.toUpperCase(),
                      )}
                    </span>
                  </div>
                ) : (
                  <p className="text-[12px] text-[#516f90]">
                    Aun no has agregado paquetes a este incremento.
                  </p>
                )}

                <div className="border-t border-[#99f6e4] pt-3">
                  <div className="flex items-center justify-between gap-4 text-[14px] font-bold text-[#00bda5]">
                    <span>Créditos totales:</span>
                    <span>{SALES_PROPOSAL_BASE_CREDITS + upsellCreditsAdded} CR</span>
                  </div>
                </div>

                <div className="border-t border-[#99f6e4] pt-3">
                  <div className="flex items-center justify-between gap-4 text-[15px] font-extrabold">
                    <span className="text-[#33475b]">Total a pagar:</span>
                    <span className="text-[#ff7a59]">
                      {formatCurrency(upsellTotalPrice, proposal.currency.toUpperCase())}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={closeUpsellModal}
                className="inline-flex h-10 flex-1 items-center justify-center rounded-[4px] border border-[#dfe3eb] bg-white px-4 text-[13px] font-bold text-[#33475b] transition hover:bg-[#f5f8fa]"
              >
                Cancelar
              </button>
              {hasHubspotUpsell ? (
                <button
                  type="button"
                  onClick={removeHubspotUpsell}
                  className="inline-flex h-10 flex-1 items-center justify-center rounded-[4px] border border-[#fecaca] bg-[#fff1f2] px-4 text-[13px] font-bold text-[#be123c] transition hover:bg-[#ffe4e6]"
                >
                  Quitar paquete
                </button>
              ) : null}
              <button
                type="button"
                onClick={confirmUpsell}
                className="inline-flex h-10 flex-1 items-center justify-center rounded-[4px] bg-[#ff7a59] px-4 text-[13px] font-bold text-white transition hover:bg-[#dc6548]"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {initiativeDraft ? (
        (() => {
          const draftCredits = calculateSalesInitiativeCredits(initiativeDraft);
          const draftOriginalCredits = calculateSalesInitiativeOriginalCredits(initiativeDraft);
          const canUseCommercialAgreement =
            isDinterwebVariant &&
            (proposal.status === "draft" || canWaiveAnyInitiative) &&
            canToggleCommercialWaiver(initiativeDraft, canWaiveAnyInitiative);
          const catalogGroupForDraft = findCatalogGroupForInitiative(initiativeDraft, catalogGroups);

          return (
        <div className="fixed inset-0 z-40 flex justify-end bg-[#33475b]/60 backdrop-blur-[2px]">
          <button type="button" className="absolute inset-0" onClick={closeInitiativeEditor} aria-label="Cerrar" />
          <aside className="relative h-full w-full max-w-[760px] overflow-y-auto border-l border-[#dfe3eb] bg-white shadow-[-16px_0_40px_rgba(51,71,91,0.12)]">
            <div className="border-b border-[#dfe3eb] bg-white px-6 py-6">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <span className={`inline-flex rounded-[3px] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${STATUS_META[initiativeDraft.status].muted}`}>
                    {STATUS_META[initiativeDraft.status].label}
                  </span>
                  <textarea
                    rows={2}
                    value={initiativeDraft.title}
                    onChange={(event) => updateInitiativeDraft("title", event.target.value)}
                    className="mt-4 block w-full resize-none border-0 bg-transparent p-0 text-[22px] font-extrabold leading-[1.1] text-[#33475b] outline-none"
                  />
                </div>
                <button type="button" onClick={closeInitiativeEditor} className="rounded-[2px] p-1 text-[#9cb1c6] hover:bg-white hover:text-[#33475b]">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-6 border-t border-dashed border-[#dfe3eb] pt-6">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#516f90]">Mover a:</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {getAllowedSalesStageTargets(initiativeDraft.status).map((status) => (
                      <button
                        key={`status-${status}`}
                        type="button"
                        onClick={() => updateInitiativeDraft("status", status)}
                        className="rounded-[3px] border border-[#cbd6e2] bg-white px-2.5 py-[5px] text-[10px] font-bold text-[#33475b] transition hover:border-[#00bda5] hover:text-[#00bda5]"
                      >
                        {STATUS_META[status].label}
                      </button>
                    ))}
                </div>
                {getAllowedSalesStageTargets(initiativeDraft.status).length === 0 ? (
                  <p className="mt-3 text-[11px] text-[#8aa0b4]">
                    Esta etapa no se puede mover desde la vista comercial.
                  </p>
                ) : null}
              </div>
            </div>

            <div className="space-y-6 px-6 py-6">
              <section className="rounded-[6px] border border-[#dfe3eb] bg-[#fcfcfc] p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#516f90]">Rango estimado</p>
                <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                  <input
                    type="date"
                    value={initiativeDraft.estStartDate}
                    onChange={(event) => updateInitiativeDraft("estStartDate", event.target.value)}
                    className="h-9 rounded-[2px] border border-[#cbd6e2] bg-white px-3 text-[12px] text-[#33475b] outline-none transition focus:border-[#00bda5]"
                  />
                  <span className="text-[11px] font-bold text-[#516f90]">al</span>
                  <input
                    type="date"
                    value={initiativeDraft.estEndDate}
                    onChange={(event) => updateInitiativeDraft("estEndDate", event.target.value)}
                    className="h-9 rounded-[2px] border border-[#cbd6e2] bg-white px-3 text-[12px] text-[#33475b] outline-none transition focus:border-[#00bda5]"
                  />
                </div>
              </section>

              <section>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#9cb1c6]">Alcance y descripcion detallada</p>
                <div className="mt-3">
                  <RichTextTextarea
                    rows={4}
                    value={initiativeDraft.description || catalogGroupForDraft?.description || ""}
                    onChange={(value) => updateInitiativeDraft("description", value)}
                    placeholder="Describe el alcance, entregables y contexto de este caso de uso."
                    className="text-[13px] leading-relaxed text-[#33475b]"
                  />
                </div>
              </section>

              {catalogGroupForDraft?.completionOutcome ? (
                <section>
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#9cb1c6]">
                    Responsabilidades del cliente
                  </p>
                  <div className="mt-3 rounded-[6px] border border-[#dfe3eb] bg-white p-5 shadow-sm">
                    <RichTextDisplay
                      value={catalogGroupForDraft.completionOutcome}
                      className="text-[13px] leading-relaxed text-[#33475b]"
                    />
                  </div>
                </section>
              ) : null}

              {catalogGroupForDraft?.successMilestone ? (
                <section>
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#9cb1c6]">
                    Criterio de Éxito
                  </p>
                  <div className="mt-3 rounded-[6px] border border-[#dfe3eb] bg-white p-5 shadow-sm">
                    <RichTextDisplay
                      value={catalogGroupForDraft.successMilestone}
                      className="text-[13px] leading-relaxed text-[#33475b]"
                    />
                  </div>
                </section>
              ) : null}

              <section className="rounded-[6px] border border-[#dfe3eb] bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#516f90]">Actividades incluidas</p>
                  <span className="text-[13px] font-bold text-[#ff7a59]">
                    {initiativeDraft.commerciallyWaived ? (
                      <>
                        <span className="mr-1 text-[#9cb1c6] line-through">
                          {draftOriginalCredits} CR
                        </span>
                        {draftCredits} CR
                      </>
                    ) : (
                      `${draftCredits} CR`
                    )}
                  </span>
                </div>

                <div className="mt-4 space-y-3">
                  {initiativeDraft.subitems.map((subitem, index) => (
                    <div key={subitem.id} className="rounded-[6px] border border-[#dfe3eb] bg-[#f5f8fa] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <textarea
                            rows={2}
                            value={subitem.name}
                            onChange={(event) => updateDraftSubitem(index, "name", event.target.value)}
                            className="block w-full resize-none border-0 bg-transparent p-0 text-[12px] font-bold leading-[1.25] text-[#33475b] outline-none"
                          />
                          {initialCatalog.find((item) => item.id === subitem.catalogItemId)?.category ? (
                            <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.12em] text-[#516f90]">
                              {initialCatalog.find((item) => item.id === subitem.catalogItemId)?.category}
                            </p>
                          ) : null}
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className="text-[9px] text-[#516f90]">{subitem.unitCredits} CR c/u</span>
                            <span className={`inline-flex items-center rounded-[999px] px-2 py-1 text-[9px] font-bold ${TASK_STATUS_META[subitem.status].muted}`}>
                              {TASK_STATUS_META[subitem.status].label}
                            </span>
                            <input
                              type="date"
                              value={subitem.targetDate}
                              onChange={(event) => updateDraftSubitem(index, "targetDate", event.target.value)}
                              className="h-7 rounded-[999px] border border-[#cbd6e2] bg-white px-2 text-[9px] text-[#516f90] outline-none transition focus:border-[#00bda5]"
                            />
                          </div>
                        </div>
                        <div className="flex items-center gap-2 pl-2">
                          <button
                            type="button"
                            onClick={() => updateDraftSubitem(index, "quantity", Math.max(1, subitem.quantity - 1))}
                            className="grid h-7 w-7 place-items-center rounded-none border border-[#cbd6e2] border-r-0 bg-white text-[13px] font-bold text-[#33475b]"
                          >
                            -
                          </button>
                          <span className="flex h-7 min-w-[18px] items-center justify-center border-y border-[#cbd6e2] bg-white px-1 text-center text-[10px] font-bold text-[#33475b]">
                            {subitem.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => updateDraftSubitem(index, "quantity", subitem.quantity + 1)}
                            className="grid h-7 w-7 place-items-center rounded-none border border-[#cbd6e2] border-l-0 bg-white text-[13px] font-bold text-[#33475b]"
                          >
                            +
                          </button>
                          <button
                            type="button"
                            onClick={() => removeDraftSubitem(index)}
                            className="ml-1 grid h-6 w-6 place-items-center text-[#ef4444]"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
                  <select
                    defaultValue=""
                    onChange={(event) => {
                      if (!event.target.value) return;
                      addDraftSubitem(event.target.value);
                      event.currentTarget.value = "";
                    }}
                    className="h-8 w-full rounded-[2px] border border-[#cbd6e2] bg-white px-3 text-[10px] text-[#33475b] outline-none transition focus:border-[#00bda5]"
                  >
                    <option value="">-- Añadir --</option>
                    {catalogOptions.map(([category, items]) => (
                      <optgroup key={`editor-${category}`} label={category}>
                        {items.map((item) => (
                          <option key={`editor-item-${item.id}`} value={item.id}>
                            {item.label} ({item.credits} CR)
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={addManualDraftSubitem}
                    className="h-8 rounded-[3px] border border-[#cbd6e2] bg-white px-3 text-[10px] font-bold text-[#33475b] transition hover:border-[#00bda5] hover:text-[#00bda5]"
                  >
                    Añadir
                  </button>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-[#dfe3eb] pt-3">
                  <p className="text-[12px] font-bold uppercase tracking-[0.08em] text-[#33475b]">Costo total:</p>
                  <div className="flex items-center gap-2">
                    {canUseCommercialAgreement ? (
                      <button
                        type="button"
                        onClick={toggleInitiativeDraftCommercialWaiver}
                        className={`h-6 rounded-[4px] border px-2 text-[10px] font-bold uppercase tracking-[0.08em] transition ${
                          initiativeDraft.commerciallyWaived
                            ? "border-[#bfe8df] bg-[#f0fffc] text-[#007f70]"
                            : "border-[#cbd6e2] bg-white text-[#516f90] opacity-85 hover:border-[#8fb3d9] hover:opacity-100"
                        }`}
                      >
                        {initiativeDraft.commerciallyWaived ? "Bonificado" : "Acuerdo"}
                      </button>
                    ) : null}
                    <p className="text-[14px] font-bold text-[#ff7a59]">
                      {initiativeDraft.commerciallyWaived ? (
                        <>
                          <span className="mr-1 text-[#9cb1c6] line-through">
                            {draftOriginalCredits} CR
                          </span>
                          {draftCredits} CR
                        </>
                      ) : (
                        `${draftCredits} CR`
                      )}
                    </p>
                  </div>
                </div>
              </section>

              <section className="rounded-[6px] border border-[#dfe3eb] bg-[#fcfcfc] p-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#516f90]">Cliente</p>
                    <div className="mt-2 border-b border-dashed border-[#00bda5] pb-1 text-[12px] font-semibold text-[#33475b]">
                      {proposal.clientCompany || proposal.clientName}
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#516f90]">Asignacion CS</p>
                    <div className="mt-2 border-b border-dashed border-[#00bda5] pb-1 text-[12px] font-semibold text-[#33475b]">
                      {proposal.assignedCsmUserId ? "Asignado desde CS" : "Pendiente de asignacion en CS"}
                    </div>
                  </div>
                </div>
              </section>
            </div>

            <div className="border-t border-[#dfe3eb] bg-white px-4 py-4">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={saveInitiativeDraft}
                  className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-[4px] border border-[#ff7a59] bg-[#ff7a59] px-3 text-[12px] font-bold text-white transition hover:bg-[#dc6548]"
                >
                  Guardar iniciativa
                </button>
                {editingInitiativeId ? (
                  <button
                    type="button"
                    onClick={() => removeInitiative(editingInitiativeId)}
                    className="grid h-8 w-8 place-items-center rounded-[4px] border border-[#fecaca] bg-white text-[#ef4444]"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={closeInitiativeEditor}
                  className="grid h-8 w-8 place-items-center rounded-[4px] border border-[#fecaca] bg-white text-[#ef4444]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          </aside>
        </div>
          );
        })()
      ) : null}

      <FeedbackToast feedback={feedback} onClose={() => setFeedback(null)} />
    </div>
  );
}
