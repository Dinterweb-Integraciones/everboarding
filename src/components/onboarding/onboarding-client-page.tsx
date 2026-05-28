"use client";

import {
  AlertTriangle,
  CalendarDays,
  Copy,
  Download,
  Link2,
  Loader2,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FeedbackToast } from "@/components/ui/feedback-toast";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { reorderBoardItems, type DropPosition } from "@/lib/board-order";
import {
  CS_UPSELL_CREDIT_OPTIONS,
  RISK_INACTIVE_DAYS,
  STAGE_META,
  STATUS_META,
  TASK_STATUS_META,
} from "@/lib/constants";
import {
  buildCatalogGroupOptions,
  buildCatalogModalGroups,
  calculateCredits,
  calculateInitiativeProgress,
  calculateMetrics,
  calculateReductionPenalty,
  canEdit,
  createEmptyDraft,
  formatDateRange,
  getExtraCapacityCredits,
  getEstimatedStatus,
  getEffectivePlanPrice,
  getMonthlyContractCredits,
  getPlanBillingModeLabel,
  getPlanCadenceLabel,
  getPlanPeriodLabel,
  suggestPlanPrice,
  type CatalogModalGroup,
  type CustomPlanBillingMode,
  type PlanPeriodMonths,
  type InitiativeEditorDraft,
  type InitiativeRecord,
  type InitiativeStatus,
  type InitiativeTaskStatus,
  type OnboardingSnapshot,
  type ProjectStage,
} from "@/lib/onboarding";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate, formatUserError, safeParseNumber, toIsoDate } from "@/lib/utils";

type OnboardingClientPageProps = {
  initialData: OnboardingSnapshot;
  initialStage?: ProjectStage;
  userId: string;
};

function matchesCatalogGroupSearch(group: CatalogModalGroup, query: string) {
  const normalizedQuery = normalizeCatalogText(query);
  if (!normalizedQuery) return true;

  const searchableText = [
    group.name,
    group.description,
    group.modalCategory,
    ...group.items.map((item) => `${item.label} ${item.category}`),
  ]
    .map((value) => normalizeCatalogText(value))
    .join(" ");

  return searchableText.includes(normalizedQuery);
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
const taskStatusSequence: InitiativeTaskStatus[] = ["pending", "in_progress", "blocked", "completed"];
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

function isReservedStatus(status: InitiativeStatus) {
  return status === "planned" || status === "executing";
}

function getStatusDot(status: InitiativeStatus) {
  if (status === "executing") return "bg-emerald-500";
  if (status === "planned") return "bg-indigo-500";
  if (status === "completed") return "bg-slate-700";
  return "bg-slate-300";
}

function normalizeCatalogText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function getCustomerSuccessTimelineBarClass(status: InitiativeStatus) {
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

function getPanelStatusBadgeClass(status: InitiativeStatus) {
  if (status === "executing") {
    return "bg-[#eaf8f6] text-[#00bda5]";
  }

  if (status === "planned") {
    return "bg-[#f0f2fb] text-[#6a78d1]";
  }

  if (status === "completed") {
    return "bg-[#eaf0f6] text-[#33475b]";
  }

  return "bg-[#eaf0f6] text-[#516f90]";
}

function getNextTaskStatus(status: InitiativeTaskStatus) {
  const currentIndex = taskStatusSequence.indexOf(status);
  return taskStatusSequence[(currentIndex + 1) % taskStatusSequence.length] ?? "pending";
}

function formatCompactDate(value: string) {
  if (!value) return "Sin fecha";

  const parsed = parseCalendarDate(value);
  if (!parsed) return "Sin fecha";

  return new Intl.DateTimeFormat("es-NI", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(parsed);
}

function formatLongDate(value: string) {
  const parsed = parseCalendarDate(value);
  if (!parsed) return "Sin fecha";

  return new Intl.DateTimeFormat("es-NI", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(parsed);
}

function parseCalendarDate(value: string) {
  const normalized = value.trim();
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (!match) {
    return null;
  }

  const [, year, month, day] = match;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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

function getInitiativeSpanLabel(startDate: string | null, endDate: string | null, fallbackCount = 0) {
  if (startDate && endDate) {
    const parsedStart = parseCalendarDate(startDate);
    const parsedEnd = parseCalendarDate(endDate);

    if (!parsedStart || !parsedEnd) {
      return fallbackCount > 0 ? `${fallbackCount} act` : "--";
    }

    const days = Math.max(
      diffCalendarDays(parsedStart, parsedEnd) + 1,
      1,
    );
    return `${days}d`;
  }

  return fallbackCount > 0 ? `${fallbackCount} act` : "--";
}

function getSnappedDayDelta(deltaX: number, dayWidth: number) {
  if (deltaX === 0) return 0;

  const direction = deltaX > 0 ? 1 : -1;
  const snappedUnits = Math.floor((Math.abs(deltaX) + dayWidth * 0.35) / dayWidth);

  return direction * snappedUnits;
}

function minCalendarDate(values: Date[]) {
  return values.reduce((earliest, current) => (current < earliest ? current : earliest));
}

function maxCalendarDate(values: Date[]) {
  return values.reduce((latest, current) => (current > latest ? current : latest));
}

function getDaysUntil(date: string | null) {
  if (!date) return null;

  const parsed = parseCalendarDate(date);
  if (!parsed) return null;

  return Math.max(
    0,
    Math.ceil(
      (parsed.getTime() - new Date().setHours(0, 0, 0, 0)) /
        (1000 * 60 * 60 * 24),
    ),
  );
}

function hasUnsupportedColorFunction(value: string) {
  return /\b(?:oklch|oklab|lab|lch)\(/i.test(value);
}

function sanitizeExportColors(root: HTMLElement) {
  const colorFallbacks: Array<[string, string, string]> = [
    ["color", "color", "#33475b"],
    ["backgroundColor", "background-color", "transparent"],
    ["borderTopColor", "border-top-color", "#dfe3eb"],
    ["borderRightColor", "border-right-color", "#dfe3eb"],
    ["borderBottomColor", "border-bottom-color", "#dfe3eb"],
    ["borderLeftColor", "border-left-color", "#dfe3eb"],
    ["textDecorationColor", "text-decoration-color", "#33475b"],
    ["outlineColor", "outline-color", "#dfe3eb"],
    ["caretColor", "caret-color", "#33475b"],
    ["fill", "fill", "#33475b"],
    ["stroke", "stroke", "#33475b"],
  ];

  const styleLookup = {
    color: (styles: CSSStyleDeclaration) => styles.color,
    backgroundColor: (styles: CSSStyleDeclaration) => styles.backgroundColor,
    borderTopColor: (styles: CSSStyleDeclaration) => styles.borderTopColor,
    borderRightColor: (styles: CSSStyleDeclaration) => styles.borderRightColor,
    borderBottomColor: (styles: CSSStyleDeclaration) => styles.borderBottomColor,
    borderLeftColor: (styles: CSSStyleDeclaration) => styles.borderLeftColor,
    textDecorationColor: (styles: CSSStyleDeclaration) => styles.textDecorationColor,
    outlineColor: (styles: CSSStyleDeclaration) => styles.outlineColor,
    caretColor: (styles: CSSStyleDeclaration) => styles.caretColor,
    fill: (styles: CSSStyleDeclaration) => styles.fill,
    stroke: (styles: CSSStyleDeclaration) => styles.stroke,
  };

  const elements = [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))];

  elements.forEach((element) => {
    const view = element.ownerDocument.defaultView ?? window;
    const styles = view.getComputedStyle(element);

    colorFallbacks.forEach(([lookupKey, cssProperty, fallback]) => {
      const currentValue = styleLookup[lookupKey as keyof typeof styleLookup](styles);
      if (typeof currentValue === "string" && hasUnsupportedColorFunction(currentValue)) {
        element.style.setProperty(cssProperty, fallback);
      }
    });

    if (hasUnsupportedColorFunction(styles.boxShadow)) {
      element.style.boxShadow = "none";
    }
  });
}

export function OnboardingClientPage({
  initialData,
  initialStage = "cs",
  userId,
}: OnboardingClientPageProps) {
  const supabase = createSupabaseBrowserClient();
  const [client, setClient] = useState(initialData.client);
  const [config, setConfig] = useState(initialData.config);
  const [billing] = useState(initialData.billing);
  const [initiatives, setInitiatives] = useState(initialData.initiatives);
  const [activeStage] = useState<ProjectStage>(initialStage);
  const [draft, setDraft] = useState<InitiativeEditorDraft | null>(null);
  const [editingInitiativeId, setEditingInitiativeId] = useState<string | null>(null);
  const [catalogSelection, setCatalogSelection] = useState("");
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const [isSavingMeta, setIsSavingMeta] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isSavingInitiative, setIsSavingInitiative] = useState(false);
  const [isClearingBoard, setIsClearingBoard] = useState(false);
  const [isOfferModalOpen, setIsOfferModalOpen] = useState(false);
  const [isClearModalOpen, setIsClearModalOpen] = useState(false);
  const [isGeneratingWizardPlan, setIsGeneratingWizardPlan] = useState(false);
  const [wizardLoadingMessageIndex, setWizardLoadingMessageIndex] = useState(0);
  const [isUpsellModalOpen, setIsUpsellModalOpen] = useState(false);
  const [selectedUpsellCredits, setSelectedUpsellCredits] = useState<number>(CS_UPSELL_CREDIT_OPTIONS[0]);
  const [customUpsellCredits, setCustomUpsellCredits] = useState("");
  const [upsellQuantity, setUpsellQuantity] = useState(0);
  const [isCatalogModalOpen, setIsCatalogModalOpen] = useState(false);
  const [activeCatalogTab, setActiveCatalogTab] = useState<string>("wizard");
  const [catalogPreviewGroup, setCatalogPreviewGroup] = useState<CatalogModalGroup | null>(null);
  const [catalogSearchQuery, setCatalogSearchQuery] = useState("");
  const [catalogTagFilter, setCatalogTagFilter] = useState<string | null>(null);
  const [wizardHubs, setWizardHubs] = useState<string[]>([]);
  const [wizardPortalState, setWizardPortalState] = useState<"new" | "optimize">("new");
  const [wizardContext, setWizardContext] = useState("");
  const [isExportingReport, setIsExportingReport] = useState(false);
  const [offerDraft, setOfferDraft] = useState<{
    credits: number;
    price: number;
    billingMode: CustomPlanBillingMode;
    periodMonths: PlanPeriodMonths;
    validityDays: number;
  }>({
    credits: config.custom_plan_credits ?? config.base_capacity,
    price: getEffectivePlanPrice(config),
    billingMode: config.custom_plan_billing_mode ?? "subscription",
    periodMonths: (config.custom_plan_period_months ?? 1) as PlanPeriodMonths,
    validityDays: config.credit_validity_days,
  });
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
  const persistGanttDatesRef = useRef<
    ((initiative: InitiativeRecord, startDate: string, endDate: string) => Promise<void>) | null
  >(null);
  const draftSubitemDateInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const writable = canEdit(initialData.accessRole);
  const ownerCanShare = initialData.accessRole === "owner";
  const stageMeta = STAGE_META[activeStage];

  const metrics = useMemo(
    () => calculateMetrics(config, initiatives, billing),
    [billing, config, initiatives],
  );

  const groupedInitiatives = useMemo(() => {
    return boardStatuses.reduce(
      (accumulator, status) => {
        accumulator[status] = initiatives
          .filter((initiative) => initiative.status === status)
          .sort((left, right) => left.sort_order - right.sort_order);
        return accumulator;
      },
      {} as Record<InitiativeStatus, InitiativeRecord[]>,
    );
  }, [initiatives]);

  const negotiatedPlanCredits = config.custom_plan_credits ?? config.base_capacity;
  const negotiatedPlanPeriodMonths = (config.custom_plan_period_months ?? 1) as PlanPeriodMonths;
  const negotiatedPlanPrice = getEffectivePlanPrice(config);
  const negotiatedPlanBillingMode = config.custom_plan_billing_mode ?? "subscription";
  const isRecurringPlan = negotiatedPlanBillingMode === "subscription";
  const negotiatedPlanCadence =
    isRecurringPlan
      ? getPlanCadenceLabel(negotiatedPlanPeriodMonths)
      : getPlanBillingModeLabel(negotiatedPlanBillingMode);

  const catalogOptions = useMemo(() => {
    const grouped = new Map<string, typeof initialData.catalog>();

    initialData.catalog.forEach((item) => {
      const items = grouped.get(item.category) ?? [];
      items.push(item);
      grouped.set(item.category, items);
    });

    return Array.from(grouped.entries());
  }, [initialData]);
  const currentExtraCapacityCredits = useMemo(() => getExtraCapacityCredits(config), [config]);

  const catalogGroups = useMemo(() => {
    return buildCatalogModalGroups({
      groups: initialData.catalogGroups,
      categories: initialData.catalogGroupCategories,
      categoryLinks: initialData.catalogGroupCategoryLinks,
      memberships: initialData.catalogGroupMemberships,
      items: initialData.catalog,
    });
  }, [initialData]);

  const catalogGroupOptions = useMemo(() => {
    return buildCatalogGroupOptions(catalogGroups, initialData.catalogGroupCategories);
  }, [catalogGroups, initialData]);
  const catalogTabs = useMemo(
    () => [
      { id: "wizard", label: "Guía de Activación" },
      ...catalogGroupOptions.map((category) => ({ id: category.id, label: category.label })),
    ],
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

  const cycleDaysRemaining = useMemo(() => getDaysUntil(metrics.cutoffDate), [metrics.cutoffDate]);
  const ganttTimeline = useMemo(() => {
    const today = new Date();
    const windowStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const windowEnd = addCalendarDays(addRollingCalendarMonths(windowStart, 3), 1);

    const datedRows = initiatives
      .map((initiative) => {
        const subitemDates = initiative.subitems
          .map((subitem) => subitem.target_date)
          .filter((value): value is string => Boolean(value))
          .map(parseCalendarDate)
          .filter((value): value is Date => Boolean(value));

        const resolvedStart = initiative.est_start_date
          ? parseCalendarDate(initiative.est_start_date)
          : subitemDates.length
            ? minCalendarDate(subitemDates)
            : null;
        const resolvedEnd = initiative.est_end_date
          ? parseCalendarDate(initiative.est_end_date)
          : subitemDates.length
            ? maxCalendarDate(subitemDates)
            : resolvedStart;

        if (!resolvedStart || !resolvedEnd) {
          return {
            initiative,
            start: null,
            end: null,
          };
        }

        const normalizedStart = resolvedStart <= resolvedEnd ? resolvedStart : resolvedEnd;
        const normalizedEnd = resolvedEnd >= resolvedStart ? resolvedEnd : resolvedStart;

        return {
          initiative,
          start: normalizedStart,
          end: normalizedEnd,
        };
      })
      .sort((left, right) => {
        if (!left.start && !right.start) return left.initiative.sort_order - right.initiative.sort_order;
        if (!left.start) return 1;
        if (!right.start) return -1;
        return left.start.getTime() - right.start.getTime();
      });

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
        weekday: new Intl.DateTimeFormat("es-NI", { weekday: "short" }).format(date).replace(".", ""),
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
  }, [initiatives]);
  const progressParts = useMemo(() => {
    const total = Math.max(metrics.total, 1);

    return {
      consumed: (metrics.consumed / total) * 100,
      reserved: (metrics.reserved / total) * 100,
      lost: (metrics.lost / total) * 100,
      available: (Math.max(metrics.available, 0) / total) * 100,
    };
  }, [metrics.available, metrics.consumed, metrics.lost, metrics.reserved, metrics.total]);
  const hasPlanningItems = groupedInitiatives.backlog.length > 0 || groupedInitiatives.planned.length > 0;
  const defaultCatalogLibraryTab =
    catalogTabs.find((tab) => tab.id !== "wizard")?.id ?? "wizard";
  const currentPlanCredits = metrics.reserved + metrics.consumed;
  const remainingRecommendationCredits = Math.max(0, metrics.available);
  const wizardLoadingMessage =
    WIZARD_LOADING_MESSAGES[wizardLoadingMessageIndex] ?? WIZARD_LOADING_MESSAGES[0];

  useEffect(() => {
    if (!ganttDrag) return;
    const activeDrag = ganttDrag;

    function handlePointerMove(event: PointerEvent) {
      const deltaX = event.clientX - activeDrag.originX;
      const nextDelta = getSnappedDayDelta(deltaX, ganttTimeline.dayWidth);
      setGanttDrag((current) => (current ? { ...current, dayDelta: nextDelta } : current));
    }

    function handlePointerUp() {
      setGanttDrag(null);

      if (!activeDrag || activeDrag.dayDelta === 0) {
        return;
      }

      const initiative = initiatives.find((item) => item.id === activeDrag.initiativeId);
      if (!initiative) return;

      const startBase = parseCalendarDate(activeDrag.startDate);
      const endBase = parseCalendarDate(activeDrag.endDate);
      if (!startBase || !endBase) {
        return;
      }

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

      void persistGanttDatesRef.current?.(initiative, nextStart, nextEnd);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [ganttDrag, ganttTimeline.dayWidth, initiatives]);

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

  function showError(message: string | null) {
    setFeedback(
      message
        ? {
            tone: "error",
            message: formatUserError(message, "No pudimos guardar los cambios. Intenta de nuevo."),
          }
        : null,
    );
  }

  function showSuccess(message: string) {
    setFeedback({ tone: "success", message });
  }

  function requiresPaidCycle(status: InitiativeStatus) {
    return status === "planned" || status === "executing";
  }

  function canUseReservedStage(status: InitiativeStatus) {
    return !requiresPaidCycle(status) || billing.current_cycle_paid;
  }

  function showPaymentRequiredMessage() {
    showError(
      "Este ciclo mensual no esta pagado. Para crear o mover tareas a Planificado o En ejecucion, primero debe completarse el pago del ciclo.",
    );
  }

  function openOfferModal() {
    setOfferDraft({
      credits: config.custom_plan_credits ?? config.base_capacity,
      price: getEffectivePlanPrice(config),
      billingMode: config.custom_plan_billing_mode ?? (config.custom_plan_type === "proyecto" ? "one_time" : "subscription"),
      periodMonths: (config.custom_plan_period_months ?? 1) as PlanPeriodMonths,
      validityDays: config.credit_validity_days,
    });
    setIsOfferModalOpen(true);
  }

  function applyOfferDraft() {
    setConfig((current) => ({
      ...current,
      base_capacity: getMonthlyContractCredits({
        base_capacity: offerDraft.credits,
        custom_plan_credits: offerDraft.credits,
        custom_plan_period_months: offerDraft.periodMonths,
      }),
      custom_plan_credits: Math.max(1, offerDraft.credits),
      custom_plan_price: Math.max(0, offerDraft.price),
      custom_plan_type: offerDraft.billingMode === "subscription" ? "mensual" : "proyecto",
      custom_plan_billing_mode: offerDraft.billingMode,
      custom_plan_period_months: offerDraft.periodMonths,
      credit_validity_days: Math.max(1, offerDraft.validityDays),
    }));
    setIsOfferModalOpen(false);
    showSuccess("Oferta configurada. Recuerda guardar los ajustes.");
  }

  function closeUpsellModal() {
    setIsUpsellModalOpen(false);
  }

  function getResolvedUpsellCredits() {
    if (selectedUpsellCredits === -1) {
      return Math.max(0, safeParseNumber(customUpsellCredits));
    }

    return selectedUpsellCredits;
  }

  function confirmUpsellCredits() {
    const resolvedCredits = getResolvedUpsellCredits();
    if (!upsellQuantity || resolvedCredits <= 0) {
      closeUpsellModal();
      return;
    }

    const creditsToAdd = resolvedCredits * upsellQuantity;
    setConfig((current) => ({
      ...current,
      extra_capacity: getExtraCapacityCredits(current) + creditsToAdd,
    }));
    showSuccess(`Capacidad incrementada en ${creditsToAdd} creditos. Recuerda guardar los ajustes.`);
    closeUpsellModal();
  }

  function toggleWizardHub(hub: string) {
    setWizardHubs((current) =>
      current.includes(hub) ? current.filter((value) => value !== hub) : [...current, hub],
    );
  }

  function openCatalogModal(tab?: string) {
    const nextTab = tab ?? (hasPlanningItems ? defaultCatalogLibraryTab : "wizard");
    setActiveCatalogTab(nextTab);
    setCatalogPreviewGroup(null);
    setCatalogSearchQuery("");
    setIsCatalogModalOpen(true);
  }

  function closeCatalogModal() {
    setIsCatalogModalOpen(false);
    setCatalogPreviewGroup(null);
    setCatalogSearchQuery("");
  }

  function openCatalogGroupPreview(group: CatalogModalGroup) {
    setCatalogPreviewGroup(group);
  }

  function closeCatalogGroupPreview() {
    setCatalogPreviewGroup(null);
  }

  async function removeCatalogGroup(group: CatalogModalGroup) {
    const matchingInitiative = initiatives.find(
      (initiative) => normalizeCatalogText(initiative.title) === normalizeCatalogText(group.name),
    );
    if (!matchingInitiative) return;

    await deleteInitiative(matchingInitiative);
  }

  function findCatalogGroupsByCategory(category: string) {
    return (
      catalogGroupOptions.find(
        (entry) => normalizeCatalogText(entry.label) === normalizeCatalogText(category),
      )?.groups ?? []
    );
  }

  function fitRecommendationsToCreditBudget(
    recommendations: WizardRecommendation[],
    creditBudget: number,
  ) {
    const groupsById = new Map(catalogGroups.map((group) => [group.id, group]));
    const existingTitles = new Set(
      initiatives.map((initiative) => normalizeCatalogText(initiative.title)),
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
      if (groupCredits === 0 || recommendation.status === "backlog") {
        return true;
      }

      if (usedCredits + groupCredits > creditBudget) {
        return false;
      }

      usedCredits += groupCredits;
      return true;
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

  async function persistConfig(nextConfig: typeof config, successMessage?: string) {
    const { data, error } = await supabase
      .from("onboarding_configs")
      .upsert({
        ...nextConfig,
        updated_by_user_id: userId,
      })
      .select("*")
      .single();

    if (error) {
      showError(error.message);
      return null;
    }

    setConfig(data);
    if (successMessage) showSuccess(successMessage);
    return data;
  }

  async function persistClientMeta(successMessage?: string) {
    const { data, error } = await supabase
      .from("clients")
      .update({
        name: client.name.trim(),
        description: client.description?.trim() || null,
      })
      .eq("id", client.id)
      .select("*")
      .single();

    if (error) {
      showError(error.message);
      return null;
    }

    setClient((current) => ({ ...current, ...data }));
    if (successMessage) showSuccess(successMessage);
    return data;
  }

  async function saveAllAdjustments() {
    setFeedback(null);
    setIsSavingMeta(true);
    setIsSavingConfig(true);

    const savedClient = await persistClientMeta();
    const savedConfig = await persistConfig(config);

    setIsSavingMeta(false);
    setIsSavingConfig(false);

    if (!savedClient || !savedConfig) return;
    showSuccess("Ajustes guardados.");
  }

  function copyCurrentViewLink() {
    const url = new URL(window.location.href);
    url.searchParams.set("stage", activeStage);
    navigator.clipboard.writeText(url.toString()).then(() => {
      showSuccess("Vista actual copiada.");
    });
  }

  function buildPublicOnboardingUrl(audience: "client" | "prospect") {
    return `${window.location.origin}/public/${audience}/${client.id}`;
  }

  function copyPublicOnboardingLink(audience: "client" | "prospect") {
    if (!ownerCanShare) return;

    navigator.clipboard.writeText(buildPublicOnboardingUrl(audience)).then(() => {
      showSuccess(
        audience === "client"
          ? "Link publico para cliente copiado."
          : "Link publico para prospecto copiado.",
      );
    });
  }

  function openCreateModal(status: InitiativeStatus) {
    setEditingInitiativeId(null);
    setDraft(createEmptyDraft(status));
    setCatalogSelection("");
  }

  function openGroupedDraft(status: InitiativeStatus) {
    const selectedCatalogId = quickAddSelections[status];
    const selectedItem = initialData.catalog.find((item) => item.id === selectedCatalogId);
    const nextDraft = createEmptyDraft(status);

    if (selectedItem) {
      nextDraft.title = selectedItem.label;
      nextDraft.type = selectedItem.category;
      nextDraft.subitems = [
        {
          catalogItemId: selectedItem.id,
          name: selectedItem.label,
          status: "pending",
          targetDate: "",
          unitCredits: selectedItem.credits,
          quantity: 1,
        },
      ];
    }

    setEditingInitiativeId(null);
    setDraft(nextDraft);
    setCatalogSelection(selectedCatalogId);
  }

  function openEditModal(initiative: InitiativeRecord) {
    setEditingInitiativeId(initiative.id);
    setDraft({
      id: initiative.id,
      title: initiative.title,
      type: initiative.type ?? "",
      labels: initiative.labels ?? [],
      status: initiative.status,
      description: initiative.description ?? "",
      ownerClient: initiative.owner_client ?? "",
      ownerCSM: initiative.owner_csm ?? "",
      estStartDate: initiative.est_start_date ?? "",
      estEndDate: initiative.est_end_date ?? "",
      isBlocked: initiative.is_blocked,
      subitems: initiative.subitems.map((subitem) => ({
        id: subitem.id,
        catalogItemId: subitem.catalog_item_id,
        name: subitem.name,
        status: subitem.status,
        targetDate: subitem.target_date ?? "",
        unitCredits: subitem.unit_credits,
        quantity: subitem.quantity,
      })),
      note: "",
    });
    setCatalogSelection("");
  }

  function updateDraftSubitem(
    index: number,
    field: "name" | "status" | "targetDate" | "unitCredits" | "quantity",
    value: string,
  ) {
    if (!draft) return;

    const nextSubitems = [...draft.subitems];
    const target = nextSubitems[index];
    if (!target) return;

    if (field === "name") target.name = value;
    if (field === "status") target.status = value as InitiativeTaskStatus;
    if (field === "targetDate") target.targetDate = value;
    if (field === "unitCredits") target.unitCredits = safeParseNumber(value);
    if (field === "quantity") target.quantity = Math.max(1, safeParseNumber(value));

    setDraft({ ...draft, subitems: nextSubitems });
  }

  function addCatalogItem() {
    if (!draft || !catalogSelection) return;

    const selectedItem = initialData.catalog.find((item) => item.id === catalogSelection);
    if (!selectedItem) return;

    setDraft({
      ...draft,
      subitems: [
        ...draft.subitems,
        {
          catalogItemId: selectedItem.id,
          name: selectedItem.label,
          status: "pending",
          targetDate: "",
          unitCredits: selectedItem.credits,
          quantity: 1,
        },
      ],
    });
    setCatalogSelection("");
  }

  function addManualSubitem() {
    if (!draft) return;

    setDraft({
      ...draft,
      subitems: [
        ...draft.subitems,
        {
          catalogItemId: null,
          name: "Nueva actividad",
          status: "pending",
          targetDate: "",
          unitCredits: 1,
          quantity: 1,
        },
      ],
    });
  }

  function removeDraftSubitem(index: number) {
    if (!draft) return;

    setDraft({
      ...draft,
      subitems: draft.subitems.filter((_, itemIndex) => itemIndex !== index),
    });
  }

  async function insertCatalogGroupInitiative(
    group: CatalogModalGroup,
    status: InitiativeStatus,
    options?: {
      estStartDate?: string | null;
      estEndDate?: string | null;
      logEntry?: string;
      sortOrder?: number;
    },
  ) {
    const nowDate = toIsoDate();
    const { data: insertedInitiative, error: insertError } = await supabase
      .from("onboarding_initiatives")
      .insert({
        client_id: client.id,
        title: group.name,
        type: group.modalCategory || group.name,
        status,
        description: group.description || null,
        owner_client: null,
        owner_csm: null,
        est_start_date: options?.estStartDate ?? null,
        est_end_date: options?.estEndDate ?? null,
        date_planned: nowDate,
        last_activity: nowDate,
        is_blocked: false,
        sort_order: options?.sortOrder ?? groupedInitiatives[status].length,
        created_by_user_id: userId,
        updated_by_user_id: userId,
      })
      .select("*")
      .single();

    if (insertError) {
      throw insertError;
    }

    const subitemsPayload = (group.items.length
      ? group.items.map((item, index) => ({
          initiative_id: insertedInitiative.id,
          catalog_item_id: item.id,
          name: item.label,
          status: "pending" as const,
          target_date: null,
          unit_credits: item.credits,
          quantity: 1,
          sort_order: index,
        }))
      : [{
          initiative_id: insertedInitiative.id,
          catalog_item_id: null,
          name: group.name,
          status: "pending" as const,
          target_date: null,
          unit_credits: Math.max(1, safeParseNumber(group.credits)),
          quantity: 1,
          sort_order: 0,
        }]);

    const { data: insertedSubitems, error: subitemsError } = await supabase
      .from("onboarding_initiative_subitems")
      .insert(subitemsPayload)
      .select("*");

    if (subitemsError) {
      throw subitemsError;
    }

    const { data: insertedLogs, error: logsError } = await supabase
      .from("onboarding_activity_logs")
      .insert({
        initiative_id: insertedInitiative.id,
        entry: options?.logEntry ?? "Grupo agregado desde catalogo.",
        created_by_user_id: userId,
      })
      .select("*");

    if (logsError) {
      throw logsError;
    }

    return {
      ...insertedInitiative,
      subitems: (insertedSubitems ?? []).sort(
        (left: { sort_order: number }, right: { sort_order: number }) =>
          left.sort_order - right.sort_order,
      ),
      logs: insertedLogs ?? [],
      credits: calculateCredits(insertedSubitems ?? []),
      progressPercent: calculateInitiativeProgress(insertedSubitems ?? []),
    };
  }

  async function persistWizardRecommendations(
    recommendations: WizardRecommendation[],
    feedbackMessage: string,
  ) {
    const groupById = new Map(catalogGroups.map((group) => [group.id, group]));
    const existingTitles = new Set(
      initiatives.map((initiative) => normalizeCatalogText(initiative.title)),
    );
    const sortOrderByStatus = {
      backlog: groupedInitiatives.backlog.length,
      planned: groupedInitiatives.planned.length,
      executing: groupedInitiatives.executing.length,
      completed: groupedInitiatives.completed.length,
    } satisfies Record<InitiativeStatus, number>;
    const insertedInitiatives: InitiativeRecord[] = [];
    let remainingCredits = metrics.available;

    for (const recommendation of recommendations) {
      const group = groupById.get(recommendation.groupId);
      if (!group) continue;

      const normalizedTitle = normalizeCatalogText(group.name);
      if (existingTitles.has(normalizedTitle)) {
        continue;
      }

      const groupCredits = Math.max(0, safeParseNumber(group.credits));
      let nextStatus: InitiativeStatus = recommendation.status;

      if (nextStatus !== "backlog" && !canUseReservedStage(nextStatus)) {
        nextStatus = "backlog";
      }

      if (nextStatus !== "backlog") {
        if (groupCredits > remainingCredits) {
          nextStatus = "backlog";
        } else {
          remainingCredits -= groupCredits;
        }
      }

      const initiative = await insertCatalogGroupInitiative(group, nextStatus, {
        estStartDate: nextStatus === "backlog" ? null : recommendation.startDate ?? null,
        estEndDate: nextStatus === "backlog" ? null : recommendation.endDate ?? null,
        logEntry: recommendation.reason
          ? `Grupo agregado desde guia inteligente. ${recommendation.reason}`
          : "Grupo agregado desde guia inteligente.",
        sortOrder: sortOrderByStatus[nextStatus],
      });

      sortOrderByStatus[nextStatus] += 1;
      existingTitles.add(normalizedTitle);
      insertedInitiatives.push(initiative);
    }

    if (!insertedInitiatives.length) {
      showError("No encontramos grupos nuevos para agregar con la guia inteligente.");
      return;
    }

    setInitiatives((current) => [...current, ...insertedInitiatives]);
    setActiveCatalogTab(defaultCatalogLibraryTab);
    setCatalogPreviewGroup(null);
    setIsCatalogModalOpen(false);
    showSuccess(feedbackMessage);
  }

  async function applyDefaultWizardRecommendations(message = "Plan agregado exitosamente.") {
    const budgetAwareRecommendations = fitRecommendationsToCreditBudget(
      buildDefaultWizardRecommendations(),
      remainingRecommendationCredits,
    );

    await persistWizardRecommendations(
      budgetAwareRecommendations,
      budgetAwareRecommendations.length
        ? message
        : `${message} No agregamos casos adicionales porque superarian los creditos disponibles.`,
    );
  }

  async function applyWizardRecommendations() {
    if (!wizardHubs.length) {
      showError("Completa la Guia de Activacion antes de generar el plan.");
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
          startDate: config.start_date,
          selectedHubs: wizardHubs,
          portalState: wizardPortalState,
          context: wizardContext,
          contractedCredits: metrics.total,
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
        await applyDefaultWizardRecommendations(
          "Claude no devolvio grupos validos. Aplicamos la recomendacion base del catalogo.",
        );
        return;
      }

      await persistWizardRecommendations(normalizedRecommendations, "Plan agregado exitosamente.");
    } catch (caughtError) {
      console.error("customer_success_wizard_recommendations_failed", caughtError);
      await applyDefaultWizardRecommendations(
        `No pudimos consultar Claude. Usamos la recomendacion base. ${formatUserError(caughtError, "")}`.trim(),
      );
    } finally {
      setIsGeneratingWizardPlan(false);
    }
  }

  async function addCatalogGroupInitiative(group: CatalogModalGroup, status: InitiativeStatus) {
    if (!writable) return;

    if (!canUseReservedStage(status)) {
      showPaymentRequiredMessage();
      return;
    }

    if (
      status !== "backlog" &&
      status !== "completed" &&
      Math.max(0, safeParseNumber(group.credits)) > metrics.available
    ) {
      showError(`Capacidad insuficiente. Faltan ${group.credits - metrics.available} creditos.`);
      return;
    }

    if (initiatives.some((initiative) => normalizeCatalogText(initiative.title) === normalizeCatalogText(group.name))) {
      showError("Ese grupo ya existe en el plan de trabajo.");
      return;
    }

    setFeedback(null);
    setIsSavingInitiative(true);

    try {
      const insertedInitiative = await insertCatalogGroupInitiative(group, status);

      setInitiatives((current) => [...current, insertedInitiative]);
      closeCatalogModal();
      showSuccess("Grupo agregado al plan de trabajo.");
    } catch (caughtError) {
      showError(
        caughtError instanceof Error ? caughtError.message : "No fue posible agregar el grupo.",
      );
    } finally {
      setIsSavingInitiative(false);
    }
  }

  async function quickAddInitiative(status: InitiativeStatus) {
    const selectedCatalogId = quickAddSelections[status];
    const selectedItem = initialData.catalog.find((item) => item.id === selectedCatalogId);

    if (!selectedItem) {
      showError("Selecciona una actividad para anadirla.");
      return;
    }

    if (!canUseReservedStage(status)) {
      showPaymentRequiredMessage();
      return;
    }

    if (status !== "backlog" && status !== "completed" && selectedItem.credits > metrics.available) {
      showError(`Capacidad insuficiente. Faltan ${selectedItem.credits - metrics.available} creditos.`);
      return;
    }

    setFeedback(null);
    setIsSavingInitiative(true);

    try {
      const nowDate = toIsoDate();

      const { data: insertedInitiative, error: insertError } = await supabase
        .from("onboarding_initiatives")
        .insert({
          client_id: client.id,
          title: selectedItem.label,
          type: selectedItem.category,
          status,
          description: null,
          owner_client: null,
          owner_csm: null,
          est_start_date: null,
          est_end_date: null,
          date_planned: nowDate,
          last_activity: nowDate,
          is_blocked: false,
          sort_order: groupedInitiatives[status].length,
          created_by_user_id: userId,
          updated_by_user_id: userId,
        })
        .select("*")
        .single();

      if (insertError) {
        throw insertError;
      }

      const { data: insertedSubitems, error: subitemsError } = await supabase
        .from("onboarding_initiative_subitems")
        .insert({
          initiative_id: insertedInitiative.id,
          catalog_item_id: selectedItem.id,
          name: selectedItem.label,
          unit_credits: selectedItem.credits,
          quantity: 1,
          sort_order: 0,
        })
        .select("*");

      if (subitemsError) {
        throw subitemsError;
      }

      const { data: insertedLogs, error: logsError } = await supabase
        .from("onboarding_activity_logs")
        .insert({
          initiative_id: insertedInitiative.id,
          entry: "Anadido rapido.",
          created_by_user_id: userId,
        })
        .select("*");

      if (logsError) {
        throw logsError;
      }

      setInitiatives((current) => [
        ...current,
        {
          ...insertedInitiative,
          subitems: (insertedSubitems ?? []).sort(
            (left: { sort_order: number }, right: { sort_order: number }) =>
              left.sort_order - right.sort_order,
          ),
          logs: insertedLogs ?? [],
          credits: selectedItem.credits,
        },
      ]);
      setQuickAddSelections((current) => ({ ...current, [status]: "" }));
      showSuccess("Iniciativa anadida.");
    } catch (caughtError) {
      showError(
        caughtError instanceof Error ? caughtError.message : "No fue posible anadir la iniciativa.",
      );
    } finally {
      setIsSavingInitiative(false);
    }
  }

  async function moveInitiativeToStatus(
    initiative: InitiativeRecord,
    targetStatus: InitiativeStatus,
    options?: {
      targetInitiativeId?: string | null;
      position?: DropPosition;
    },
  ) {
    if (!writable) {
      setDraggedInitiativeId(null);
      setDropTargetStatus(null);
      setDropIndicator(null);
      return;
    }

    const reorderResult = reorderBoardItems({
      items: initiatives,
      draggedId: initiative.id,
      targetStatus,
      targetId: options?.targetInitiativeId,
      position: options?.position,
      getId: (item) => item.id,
      getStatus: (item) => item.status,
      getSortOrder: (item) => item.sort_order,
      updateItem: (item, patch) => ({
        ...item,
        status: patch.status,
        sort_order: patch.sortOrder,
      }),
    });

    if (!reorderResult) {
      setDraggedInitiativeId(null);
      setDropTargetStatus(null);
      setDropIndicator(null);
      return;
    }

    const statusChanged = reorderResult.statusChanged;

    setFeedback(null);

    if (statusChanged && !canUseReservedStage(targetStatus)) {
      showPaymentRequiredMessage();
      setDraggedInitiativeId(null);
      setDropTargetStatus(null);
      setDropIndicator(null);
      return;
    }

    if (statusChanged && initiative.is_blocked) {
      showError("Esta iniciativa esta bloqueada. Debes desbloquearla antes de moverla de etapa.");
      setDraggedInitiativeId(null);
      setDropTargetStatus(null);
      setDropIndicator(null);
      return;
    }

    const currentReserved = isReservedStatus(initiative.status) ? initiative.credits : 0;
    const nextReserved = isReservedStatus(targetStatus) ? initiative.credits : 0;
    const capacityNeeded = nextReserved - currentReserved;

    if (statusChanged && capacityNeeded > metrics.available) {
      showError(`Capacidad insuficiente. Faltan ${capacityNeeded - metrics.available} creditos.`);
      setDraggedInitiativeId(null);
      setDropTargetStatus(null);
      setDropIndicator(null);
      return;
    }

    const penalty =
      statusChanged &&
      initiative.status !== "completed" &&
      initiative.status !== "backlog" &&
      targetStatus === "backlog"
        ? Math.ceil(initiative.credits * 0.2)
        : 0;

    if (penalty > 0) {
      const confirmed = window.confirm(
        `Mover esta iniciativa a evaluacion aplicara una penalidad de ${penalty} creditos. Deseas continuar?`,
      );
      if (!confirmed) {
        setDraggedInitiativeId(null);
        setDropTargetStatus(null);
        setDropIndicator(null);
        return;
      }
    }

    setIsSavingInitiative(true);

    try {
      if (penalty > 0) {
        const { data: updatedConfig, error: configError } = await supabase
          .from("onboarding_configs")
          .update({
            lost_credits: config.lost_credits + penalty,
            updated_by_user_id: userId,
          })
          .eq("client_id", client.id)
          .select("*")
          .single();

        if (configError) {
          throw configError;
        }

        setConfig(updatedConfig);
      }

      const nowDate = toIsoDate();
      const nextInitiatives = reorderResult.items.map((item) =>
        item.id === initiative.id && statusChanged
          ? {
              ...item,
              last_activity: nowDate,
            }
          : item,
      );

      const changedIds = new Set(reorderResult.changedItems.map((item) => item.id));
      const changedInitiatives = nextInitiatives.filter((item) => changedIds.has(item.id));

      const updateResults = await Promise.all(
        changedInitiatives.map(async (item) => {
          const payload: {
            sort_order: number;
            updated_by_user_id: string;
            status?: InitiativeStatus;
            last_activity?: string;
          } = {
            sort_order: item.sort_order,
            updated_by_user_id: userId,
          };

          if (item.id === initiative.id && statusChanged) {
            payload.status = targetStatus;
            payload.last_activity = nowDate;
          }

          return supabase.from("onboarding_initiatives").update(payload).eq("id", item.id);
        }),
      );

      const updateError = updateResults.find((result) => result.error)?.error;
      if (updateError) {
        throw updateError;
      }

      const logMessages = [
        statusChanged ? `Cambio a ${STATUS_META[targetStatus].label}.` : "",
        penalty > 0 ? `Penalidad ${penalty} CR.` : "",
      ].filter(Boolean);

      const { data: insertedLogs, error: logsError } = logMessages.length
        ? await supabase
            .from("onboarding_activity_logs")
            .insert(
              logMessages.map((entry) => ({
                initiative_id: initiative.id,
                entry,
                created_by_user_id: userId,
              })),
            )
            .select("*")
        : { data: [], error: null };

      if (logsError) {
        throw logsError;
      }

      setInitiatives(
        nextInitiatives.map((item) =>
          item.id === initiative.id
            ? {
                ...item,
                logs: [...(insertedLogs ?? []), ...item.logs],
              }
            : item,
        ),
      );

      if (statusChanged) {
        showSuccess(`Iniciativa movida a ${STATUS_META[targetStatus].label}.`);
      }
    } catch (caughtError) {
      showError(
        caughtError instanceof Error ? caughtError.message : "No fue posible mover la iniciativa.",
      );
    } finally {
      setDraggedInitiativeId(null);
      setDropTargetStatus(null);
      setDropIndicator(null);
      setIsSavingInitiative(false);
    }
  }

  async function saveInitiative() {
    if (!draft) return;

    setFeedback(null);

    if (!draft.title.trim()) {
      showError("La iniciativa necesita un titulo.");
      return;
    }

    if (!draft.subitems.length) {
      showError("Agrega al menos una actividad.");
      return;
    }

    const existing = initiatives.find((initiative) => initiative.id === editingInitiativeId) ?? null;

    if (!canUseReservedStage(draft.status) && (!existing || existing.status !== draft.status)) {
      showPaymentRequiredMessage();
      return;
    }

    if (existing?.is_blocked && draft.status !== existing.status && draft.isBlocked) {
      showError("Esta iniciativa esta bloqueada. Desbloqueala antes de cambiarla de etapa.");
      return;
    }

    const draftCredits = calculateCredits(
      draft.subitems.map((subitem) => ({
        unit_credits: subitem.unitCredits,
        quantity: subitem.quantity,
      })),
    );
    const currentReserved = existing && isReservedStatus(existing.status) ? existing.credits : 0;
    const nextReserved = isReservedStatus(draft.status) ? draftCredits : 0;
    const capacityNeeded = nextReserved - currentReserved;

    if (capacityNeeded > metrics.available) {
      showError(`Capacidad insuficiente. Faltan ${capacityNeeded - metrics.available} creditos.`);
      return;
    }

    let penalty = 0;
    if (existing && isReservedStatus(existing.status)) {
      if (draft.status === "backlog") penalty = Math.ceil(existing.credits * 0.2);
      else if (isReservedStatus(draft.status)) penalty = calculateReductionPenalty(existing.credits, draftCredits);
    }

    if (penalty > 0) {
      const confirmed = window.confirm(
        `Este cambio aplicara una penalidad de ${penalty} creditos. Deseas continuar?`,
      );
      if (!confirmed) return;
    }

    setIsSavingInitiative(true);
    try {
      await persistInitiative(existing, draftCredits, penalty);
    } catch (caughtError) {
      showError(
        caughtError instanceof Error ? caughtError.message : "No fue posible guardar la iniciativa.",
      );
    } finally {
      setIsSavingInitiative(false);
    }
  }

  async function persistInitiative(
    existing: InitiativeRecord | null,
    draftCredits: number,
    penalty: number,
  ) {
    const nowDate = toIsoDate();
    const sanitizedSubitems = (draft?.subitems ?? []).map((subitem, index) => ({
      id: subitem.id,
      catalogItemId: subitem.catalogItemId,
      name: subitem.name.trim(),
      status: subitem.status,
      targetDate: subitem.targetDate || null,
      unitCredits: Math.max(0, subitem.unitCredits),
      quantity: Math.max(1, subitem.quantity),
      sortOrder: index,
    }));

    if (penalty > 0) {
      const { data: updatedConfig, error: configError } = await supabase
        .from("onboarding_configs")
        .update({
          lost_credits: config.lost_credits + penalty,
          updated_by_user_id: userId,
        })
        .eq("client_id", client.id)
        .select("*")
        .single();

      if (configError) throw configError;
      setConfig(updatedConfig);
    }

    if (!draft) return;

    if (!existing) {
      const { data: insertedInitiative, error: insertError } = await supabase
        .from("onboarding_initiatives")
        .insert({
          client_id: client.id,
          title: draft.title.trim(),
          type: draft.type.trim() || null,
          labels: draft.labels,
          status: draft.status,
          description: draft.description.trim() || null,
          owner_client: draft.ownerClient.trim() || null,
          owner_csm: draft.ownerCSM.trim() || null,
          est_start_date: draft.estStartDate || null,
          est_end_date: draft.estEndDate || null,
          date_planned: nowDate,
          last_activity: nowDate,
          is_blocked: draft.isBlocked,
          sort_order: groupedInitiatives[draft.status].length,
          created_by_user_id: userId,
          updated_by_user_id: userId,
        })
        .select("*")
        .single();

      if (insertError) throw insertError;

      const { data: insertedSubitems, error: subitemsError } = await supabase
        .from("onboarding_initiative_subitems")
        .insert(
          sanitizedSubitems.map((subitem) => ({
            initiative_id: insertedInitiative.id,
            catalog_item_id: subitem.catalogItemId,
            name: subitem.name,
            status: subitem.status,
            target_date: subitem.targetDate,
            unit_credits: subitem.unitCredits,
            quantity: subitem.quantity,
            sort_order: subitem.sortOrder,
          })),
        )
        .select("*");

      if (subitemsError) throw subitemsError;

      const logEntries = ["Creada.", draft.note.trim()].filter(Boolean).map((entry) => ({
        initiative_id: insertedInitiative.id,
        entry,
        created_by_user_id: userId,
      }));
      const { data: insertedLogs, error: logsError } = logEntries.length
        ? await supabase.from("onboarding_activity_logs").insert(logEntries).select("*")
        : { data: [], error: null };
      if (logsError) throw logsError;

      setInitiatives((current) => [
        {
          ...insertedInitiative,
          subitems: (insertedSubitems ?? []).sort(
            (left: { sort_order: number }, right: { sort_order: number }) =>
              left.sort_order - right.sort_order,
          ),
          logs: insertedLogs ?? [],
          credits: draftCredits,
          progressPercent: calculateInitiativeProgress(insertedSubitems ?? []),
        },
        ...current,
      ]);
      showSuccess("Iniciativa creada.");
      setDraft(null);
      setEditingInitiativeId(null);
      return;
    }

    const statusChanged = existing.status !== draft.status;
    const blockedChanged = existing.is_blocked !== draft.isBlocked;

    const { data: updatedInitiative, error: updateError } = await supabase
      .from("onboarding_initiatives")
      .update({
        title: draft.title.trim(),
        type: draft.type.trim() || null,
        labels: draft.labels,
        status: draft.status,
        description: draft.description.trim() || null,
        owner_client: draft.ownerClient.trim() || null,
        owner_csm: draft.ownerCSM.trim() || null,
        est_start_date: draft.estStartDate || null,
        est_end_date: draft.estEndDate || null,
        last_activity: statusChanged || draft.note.trim() ? nowDate : existing.last_activity,
        is_blocked: draft.isBlocked,
        sort_order: statusChanged ? groupedInitiatives[draft.status].length : existing.sort_order,
        updated_by_user_id: userId,
      })
      .eq("id", existing.id)
      .select("*")
      .single();

    if (updateError) throw updateError;

    const { error: deleteSubitemsError } = await supabase
      .from("onboarding_initiative_subitems")
      .delete()
      .eq("initiative_id", existing.id);
    if (deleteSubitemsError) throw deleteSubitemsError;

    const { data: insertedSubitems, error: subitemsError } = await supabase
      .from("onboarding_initiative_subitems")
      .insert(
        sanitizedSubitems.map((subitem) => ({
          initiative_id: existing.id,
          catalog_item_id: subitem.catalogItemId,
          name: subitem.name,
          status: subitem.status,
          target_date: subitem.targetDate,
          unit_credits: subitem.unitCredits,
          quantity: subitem.quantity,
          sort_order: subitem.sortOrder,
        })),
      )
      .select("*");
    if (subitemsError) throw subitemsError;

    const logMessages = [
      statusChanged ? `Cambio a ${STATUS_META[draft.status].label}.` : "",
      blockedChanged ? (draft.isBlocked ? "Bloqueada." : "Desbloqueada.") : "",
      existing.credits !== draftCredits ? `Ajuste de creditos a ${draftCredits}.` : "",
      penalty > 0 ? `Penalidad ${penalty} CR.` : "",
      draft.note.trim(),
    ].filter(Boolean);

    const { data: insertedLogs, error: logsError } = logMessages.length
      ? await supabase
          .from("onboarding_activity_logs")
          .insert(
            logMessages.map((entry) => ({
              initiative_id: existing.id,
              entry,
              created_by_user_id: userId,
            })),
          )
          .select("*")
      : { data: [], error: null };
    if (logsError) throw logsError;

    setInitiatives((current) =>
      current.map((initiative) =>
        initiative.id === existing.id
          ? {
              ...updatedInitiative,
              subitems: (insertedSubitems ?? []).sort(
                (left: { sort_order: number }, right: { sort_order: number }) =>
                  left.sort_order - right.sort_order,
              ),
              logs: [...(insertedLogs ?? []), ...initiative.logs],
              credits: draftCredits,
              progressPercent: calculateInitiativeProgress(insertedSubitems ?? []),
            }
          : initiative,
      ),
    );
    showSuccess("Iniciativa actualizada.");
    setDraft(null);
    setEditingInitiativeId(null);
  }

  async function persistGanttDates(
    initiative: InitiativeRecord,
    startDate: string,
    endDate: string,
  ) {
    if (!writable) return;

    setIsSavingInitiative(true);
    setFeedback(null);

    try {
      const { data: updatedInitiative, error: updateError } = await supabase
        .from("onboarding_initiatives")
        .update({
          est_start_date: startDate,
          est_end_date: endDate,
          last_activity: toIsoDate(),
          updated_by_user_id: userId,
        })
        .eq("id", initiative.id)
        .select("*")
        .single();

      if (updateError) throw updateError;

      const { data: insertedLogs, error: logsError } = await supabase
        .from("onboarding_activity_logs")
        .insert({
          initiative_id: initiative.id,
          entry: `Fechas ajustadas en Plan de Trabajo: ${formatDateRange(startDate, endDate)}.`,
          created_by_user_id: userId,
        })
        .select("*");

      if (logsError) throw logsError;

      setInitiatives((current) =>
        current.map((item) =>
          item.id === initiative.id
            ? {
                ...item,
                ...updatedInitiative,
                logs: [...(insertedLogs ?? []), ...item.logs],
              }
            : item,
        ),
      );
      showSuccess("Fechas actualizadas desde el Plan de Trabajo.");
    } catch (caughtError) {
      showError(
        caughtError instanceof Error ? caughtError.message : "No fue posible actualizar las fechas.",
      );
    } finally {
      setIsSavingInitiative(false);
    }
  }
  persistGanttDatesRef.current = persistGanttDates;

  async function deleteInitiative(initiative: InitiativeRecord) {
    const confirmed = window.confirm(
      `Se eliminara la iniciativa "${initiative.title}" y sus actividades.`,
    );
    if (!confirmed) return;

    const { error } = await supabase.from("onboarding_initiatives").delete().eq("id", initiative.id);
    if (error) {
      showError(error.message);
      return;
    }

    setInitiatives((current) => current.filter((item) => item.id !== initiative.id));
    setDraft(null);
    setEditingInitiativeId(null);
    showSuccess("Iniciativa eliminada.");
  }

  async function clearBoard() {
    setFeedback(null);
    setIsClearingBoard(true);

    try {
      const { error } = await supabase
        .from("onboarding_initiatives")
        .delete()
        .eq("client_id", client.id);

      if (error) {
        throw error;
      }

      const nextConfig = {
        ...config,
        lost_credits: 0,
        show_all_completed: false,
        updated_by_user_id: userId,
      };

      const { data: updatedConfig, error: configError } = await supabase
        .from("onboarding_configs")
        .upsert(nextConfig)
        .select("*")
        .single();

      if (configError) {
        throw configError;
      }

      setInitiatives([]);
      setConfig(updatedConfig);
      setIsClearModalOpen(false);
      showSuccess("El board fue limpiado correctamente.");
    } catch (caughtError) {
      showError(
        caughtError instanceof Error ? caughtError.message : "No fue posible limpiar el board.",
      );
    } finally {
      setIsClearingBoard(false);
    }
  }

  async function exportPdf() {
    const reportRoot = document.getElementById("report-export-root");
    if (!reportRoot) return;

    const pages = Array.from(
      reportRoot.querySelectorAll<HTMLElement>('[data-report-page="true"]'),
    );
    if (!pages.length) return;

    setFeedback(null);
    setIsExportingReport(true);

    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);

      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const margin = 8;

      for (const [index, page] of pages.entries()) {
        const canvas = await html2canvas(page, {
          scale: 1.6,
          backgroundColor: "#f5f8fa",
          useCORS: true,
          onclone: (clonedDocument) => {
            const clonedPage = clonedDocument.getElementById(page.id);
            if (clonedPage instanceof HTMLElement) {
              sanitizeExportColors(clonedPage);
            } else if (clonedDocument.body) {
              sanitizeExportColors(clonedDocument.body);
            }
          },
        });

        const imageData = canvas.toDataURL("image/png");
        const usableWidth = pdfWidth - margin * 2;
        const usableHeight = pdfHeight - margin * 2;
        const ratio = Math.min(usableWidth / canvas.width, usableHeight / canvas.height);
        const renderWidth = canvas.width * ratio;
        const renderHeight = canvas.height * ratio;
        const offsetX = (pdfWidth - renderWidth) / 2;
        const offsetY = (pdfHeight - renderHeight) / 2;

        if (index > 0) {
          pdf.addPage();
        }

        pdf.addImage(imageData, "PNG", offsetX, offsetY, renderWidth, renderHeight);
      }

      pdf.save(`Roadmap_Cliente_${Date.now()}.pdf`);
      showSuccess("Reporte exportado correctamente.");
    } catch (caughtError) {
      showError(
        caughtError instanceof Error
          ? caughtError.message
          : "No fue posible exportar el reporte.",
      );
    } finally {
      setIsExportingReport(false);
    }
  }

  const currentEditingInitiative =
    editingInitiativeId ? initiatives.find((initiative) => initiative.id === editingInitiativeId) ?? null : null;
  const isDraftModified = draft
    ? editingInitiativeId
      ? JSON.stringify({
          title: draft.title,
          type: draft.type,
          labels: draft.labels,
          status: draft.status,
          description: draft.description,
          ownerClient: draft.ownerClient,
          ownerCSM: draft.ownerCSM,
          estStartDate: draft.estStartDate,
          estEndDate: draft.estEndDate,
          isBlocked: draft.isBlocked,
          subitems: draft.subitems,
          note: draft.note,
        }) !==
        JSON.stringify({
          title: currentEditingInitiative?.title ?? "",
          type: currentEditingInitiative?.type ?? "",
          labels: currentEditingInitiative?.labels ?? [],
          status: currentEditingInitiative?.status ?? "backlog",
          description: currentEditingInitiative?.description ?? "",
          ownerClient: currentEditingInitiative?.owner_client ?? "",
          ownerCSM: currentEditingInitiative?.owner_csm ?? "",
          estStartDate: currentEditingInitiative?.est_start_date ?? "",
          estEndDate: currentEditingInitiative?.est_end_date ?? "",
          isBlocked: currentEditingInitiative?.is_blocked ?? false,
          subitems:
            currentEditingInitiative?.subitems.map((subitem) => ({
              id: subitem.id,
              catalogItemId: subitem.catalog_item_id,
              name: subitem.name,
              status: subitem.status,
              targetDate: subitem.target_date ?? "",
              unitCredits: subitem.unit_credits,
              quantity: subitem.quantity,
            })) ?? [],
          note: "",
        })
      : Boolean(
          draft.title.trim() ||
            draft.description.trim() ||
            draft.ownerClient.trim() ||
            draft.ownerCSM.trim() ||
            draft.estStartDate ||
            draft.estEndDate ||
            draft.subitems.length ||
            draft.note.trim(),
        )
    : false;

  return (
    <div className="space-y-6" id="onboarding-export-root">
      <div className="overflow-hidden border-b border-[#dfe3eb] bg-white">
        <div className="bg-white px-6 py-4">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex min-h-11 min-w-[180px] max-w-[360px] items-center text-[28px] font-semibold tracking-[-0.02em] text-[#33475b]">
                  {client.name}
                </span>
                <span className="h-5 w-px bg-[#dfe3eb]" aria-hidden="true" />
                <div className="flex items-center gap-2 text-[11px] text-[#516f90]">
                  <CalendarDays className="h-3.5 w-3.5" />
                  <span>{formatLongDate(config.start_date)}</span>
                </div>
                <span className="h-5 w-px bg-[#dfe3eb]" aria-hidden="true" />
                <span className="rounded-[3px] bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">
                  {isRecurringPlan ? "Recurrente" : "Paquete de créditos"}
                </span>
                {isRecurringPlan ? (
                  <span className="rounded-[3px] bg-[#f5f8fa] px-2 py-1 text-[10px] font-bold text-[#516f90]">
                    {cycleDaysRemaining !== null
                      ? `${cycleDaysRemaining} d restantes del ciclo`
                      : "Sin ciclo activo"}
                  </span>
                ) : null}
                <span
                  className={`rounded-[3px] px-2 py-1 text-[10px] font-bold ${
                    billing.current_cycle_paid
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {billing.current_cycle_paid ? "Ciclo pagado" : "Pago pendiente"}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-8 gap-y-3 text-[10px] font-medium sm:gap-x-10 sm:text-[11px] lg:gap-x-12">
                <div className="min-w-0 whitespace-nowrap">
                  <span className="uppercase tracking-[0.14em] text-[#9cb1c6]">Disponibles</span>
                  <span className="ml-1.5 text-[14px] font-bold text-[#00bda5] sm:text-[15px] xl:text-[16px]">
                    {metrics.available} créditos
                  </span>
                </div>
                <div className="min-w-0 whitespace-nowrap">
                  <span className="uppercase tracking-[0.14em] text-[#9cb1c6]">Comprometidos</span>
                  <span className="ml-1.5 text-[14px] font-bold text-[#6a78d1] sm:text-[15px] xl:text-[16px]">
                    {metrics.reserved} créditos
                  </span>
                </div>
                <div className="min-w-0 whitespace-nowrap">
                  <span className="uppercase tracking-[0.14em] text-[#9cb1c6]">Completados</span>
                  <span className="ml-1.5 text-[14px] font-bold text-[#33475b] sm:text-[15px] xl:text-[16px]">
                    {metrics.consumed} créditos
                  </span>
                </div>
                <div className="min-w-0 whitespace-nowrap">
                  <span className="uppercase tracking-[0.14em] text-[#9cb1c6]">Aprovechamiento</span>
                  <span className="ml-1.5 text-[14px] font-bold text-[#6a78d1] sm:text-[15px] xl:text-[16px]">
                    {metrics.total ? Math.round(((metrics.reserved + metrics.consumed) / metrics.total) * 100) : 0}%
                  </span>
                </div>
                <div className="min-w-0 whitespace-nowrap">
                  <span className="uppercase tracking-[0.14em] text-[#9cb1c6]">Deducidos</span>
                  <span className="ml-1.5 text-[14px] font-bold text-[#94a3b8] sm:text-[15px] xl:text-[16px]">
                    {metrics.lost} créditos
                  </span>
                </div>
              </div>

            </div>

            {writable ? (
              activeStage === "cs" ? (
                <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] font-bold text-[#516f90]">
                  <div className="flex items-center gap-3">
                    {ownerCanShare ? (
                      <Button
                        variant="secondary"
                        className="h-10 rounded-[8px] border-[#cbd6e2] bg-white px-4 text-[12px] font-semibold text-[#33475b] shadow-none hover:border-[#9cb1c6] hover:bg-[#f8fbfd]"
                        onClick={() => copyPublicOnboardingLink("client")}
                      >
                        <Link2 className="mr-2 h-3.5 w-3.5" />
                        Copiar link para cliente
                      </Button>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      className="rounded-[3px] bg-[#00bda5] px-3 py-2 text-[11px] font-bold text-white hover:bg-[#00a894]"
                      onClick={saveAllAdjustments}
                      disabled={isSavingConfig || isSavingMeta}
                    >
                      {isSavingConfig || isSavingMeta ? "Guardando..." : "Guardar ajustes"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-end gap-3 text-[11px] font-bold text-[#516f90]">
                  {ownerCanShare ? (
                    <>
                      <Button
                        variant="secondary"
                        className="h-10 rounded-[8px] border-[#cbd6e2] bg-white px-4 text-[12px] font-semibold text-[#33475b] shadow-none hover:border-[#9cb1c6] hover:bg-[#f8fbfd]"
                        onClick={() => copyPublicOnboardingLink("client")}
                      >
                        <Link2 className="mr-2 h-3.5 w-3.5" />
                        Copiar link para cliente
                      </Button>
                      <Button
                        variant="secondary"
                        className="h-10 rounded-[8px] border-[#cbd6e2] bg-white px-4 text-[12px] font-semibold text-[#33475b] shadow-none hover:border-[#ffb49f] hover:bg-[#fff7f3] hover:text-[#ff7a59]"
                        onClick={() => copyPublicOnboardingLink("prospect")}
                      >
                        <Link2 className="mr-2 h-3.5 w-3.5" />
                        Copiar link para prospecto
                      </Button>
                      <span className="h-5 w-px bg-[#dfe3eb]" aria-hidden="true" />
                    </>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setIsClearModalOpen(true)}
                    className="inline-flex items-center gap-1.5 transition hover:text-[#ef4444]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Limpiar
                  </button>
                  <span className="h-5 w-px bg-[#dfe3eb]" aria-hidden="true" />
                  <div className="flex items-center gap-2">
                    <span>Oferta:</span>
                    <span className="text-[#33475b]">
                      {negotiatedPlanCredits} CR · {formatCurrency(negotiatedPlanPrice)}
                    </span>
                  </div>
                  <span className="h-5 w-px bg-[#dfe3eb]" aria-hidden="true" />
                  <button
                    type="button"
                    onClick={openOfferModal}
                    className="inline-flex items-center gap-1.5 transition hover:text-[#33475b]"
                  >
                    Configurar oferta
                  </button>
                  <Button
                    className="rounded-[3px] bg-[#00bda5] px-3 py-2 text-[11px] font-bold text-white hover:bg-[#00a894]"
                    onClick={saveAllAdjustments}
                    disabled={isSavingConfig || isSavingMeta}
                  >
                    {isSavingConfig || isSavingMeta ? "Guardando..." : "Guardar ajustes"}
                  </Button>
                </div>
              )
            ) : (
              <div className="flex items-center justify-end">
                <span className="rounded-[3px] bg-[#f5f8fa] px-3 py-2 text-[11px] font-bold text-[#516f90]">
                  Vista de seguimiento
                </span>
              </div>
            )}
            </div>

            <div className="h-[4px] w-full overflow-hidden rounded-full bg-[#eaf0f6]">
              <div className="flex h-full w-full">
                <div
                  className="h-full bg-[#33475b]"
                  style={{ width: `${progressParts.consumed}%` }}
                />
                <div
                  className="h-full bg-[#6a78d1]"
                  style={{ width: `${progressParts.reserved}%` }}
                />
                <div
                  className="h-full bg-[#cbd6e2]"
                  style={{ width: `${progressParts.lost}%` }}
                />
                <div
                  className="h-full bg-[#00bda5]"
                  style={{ width: `${progressParts.available}%` }}
                />
              </div>
            </div>
          </div>

          {activeStage === "cs" ? null : (
          <div className="mt-4 grid gap-3 lg:grid-cols-[1.4fr_0.8fr_0.8fr_0.8fr]">
            <label className="space-y-2 xl:col-span-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#9cb1c6]">
                Contexto del cliente
              </span>
              <Textarea
                rows={2}
                value={client.description ?? ""}
                disabled={!writable}
                onChange={(event) =>
                  setClient((current) => ({ ...current, description: event.target.value }))
                }
                className="rounded-[4px] border-[#cbd6e2] bg-[#fcfcfc] text-[11px] text-[#516f90]"
                placeholder="Objetivos, alcance y observaciones."
              />
            </label>
            <label className="space-y-2 xl:col-span-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#9cb1c6]">
                Inicio
              </span>
              <Input
                type="date"
                value={config.start_date}
                disabled={!writable}
                onChange={(event) =>
                  setConfig((current) => ({ ...current, start_date: event.target.value }))
                }
                className="rounded-[4px] border-[#cbd6e2] bg-[#fcfcfc] text-[11px]"
              />
            </label>
            <label className="space-y-2 xl:col-span-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#9cb1c6]">
                Vigencia créditos
              </span>
              <Input
                type="number"
                min={1}
                value={config.credit_validity_days}
                disabled={!writable}
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    credit_validity_days: Math.max(1, safeParseNumber(event.target.value)),
                  }))
                }
                className="rounded-[4px] border-[#cbd6e2] bg-[#fcfcfc] text-[11px]"
              />
            </label>
            <label className="space-y-2 xl:col-span-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#9cb1c6]">
                Vista actual
              </span>
              <div className="flex items-center justify-between rounded-[4px] border border-[#cbd6e2] bg-[#fcfcfc] px-3 py-2 text-[11px] text-[#516f90]">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  <span>{stageMeta.description}</span>
                </div>
                <button type="button" onClick={copyCurrentViewLink} className="text-[#00bda5]">
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
            </label>
          </div>
          )}
        </div>
      </div>

      {activeStage === "sales" ? (
        <section className="border-b border-[#dfe3eb] bg-white px-6 py-4">
          <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-[6px] border border-[#dfe3eb] bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
              <div className="flex items-center gap-2 text-[17px] font-extrabold tracking-tight text-[#33475b]">
                <Sparkles className="h-5 w-5 text-[#ff7a59]" />
                <span>Paga por Resultados, No por Horas.</span>
              </div>
              <div className="mt-3 space-y-2 text-[12.5px] leading-snug text-[#516f90]">
                <p>Las empresas no fallan por falta de herramientas, sino por falta de ejecucion.</p>
                <p>El vendedor comparte exactamente esta vista al prospecto, sin duplicar proyectos.</p>
                <p>Los creditos mantienen una vigencia de {config.credit_validity_days} dias desde su compra.</p>
              </div>
            </div>

            <div className="grid gap-2 md:grid-cols-3">
              <div className="rounded-[4px] border border-[#ff7a59] bg-[#fff3f0] px-3 py-3 text-center">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#9cb1c6]">
                  Creditos negociados
                </p>
                <p className="mt-2 text-[18px] font-extrabold text-[#33475b]">{negotiatedPlanCredits} CR</p>
                <p className="mt-1 text-[11px] text-[#516f90]">Capacidad del ciclo</p>
              </div>
              <div className="rounded-[4px] border border-[#ff7a59] bg-[#fff3f0] px-3 py-3 text-center">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#9cb1c6]">
                  Precio negociado
                </p>
                <p className="mt-2 text-[18px] font-extrabold text-[#33475b]">
                  {formatCurrency(negotiatedPlanPrice)}
                </p>
                <p className="mt-1 text-[11px] text-[#516f90]">{negotiatedPlanCadence}</p>
              </div>
              <div className="rounded-[4px] border border-[#dfe3eb] bg-[#f5f8fa] px-3 py-3 text-center">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#9cb1c6]">
                  Vigencia
                </p>
                <p className="mt-2 text-[18px] font-extrabold text-[#33475b]">
                  {config.credit_validity_days} dias
                </p>
                <p className="mt-1 text-[11px] text-[#516f90]">Creditos no usados</p>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section className="border-b border-[#dfe3eb] bg-[#f5f8fa] px-3 py-4">
        <div className="overflow-x-auto overflow-y-hidden">
          <div className="flex min-h-[270px] min-w-max gap-4">
            {boardStatuses.map((status) => {
              const visibleItems =
                status === "completed" && !config.show_all_completed
                  ? groupedInitiatives[status].slice(0, 6)
                  : groupedInitiatives[status];
              const totalCredits = groupedInitiatives[status].reduce(
                (sum, initiative) => sum + initiative.credits,
                0,
              );
              const allowsQuickAdd = writable && (status === "backlog" || status === "planned");
              const showsBottomCreateButton =
                writable && activeStage !== "cs" && (status === "backlog" || status === "planned");

              return (
                <div key={status} className="flex w-[340px] flex-col">
                  <div className="mb-2 flex items-center justify-between px-1">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`h-2.5 w-2.5 rounded-full ${getStatusDot(status)}`} />
                        <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-[#516f90]">
                          {STATUS_META[status].label}
                        </p>
                      </div>
                    </div>
                    <span className="rounded-[2px] bg-[#eaf0f6] px-2 py-0.5 text-[10px] font-bold text-[#516f90]">
                      {totalCredits} CR
                    </span>
                  </div>

                  <div
                    className={`min-h-[220px] flex-1 space-y-3 rounded-[4px] border border-dashed p-2 transition ${
                      dropTargetStatus === status
                        ? "border-[#9cb1c6] bg-[#eaf0f6]"
                        : "border-transparent bg-transparent"
                    }`}
                    onDragOver={(event) => {
                      if (!writable) return;
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
                      if (!writable) return;
                      event.preventDefault();
                      const initiativeId = event.dataTransfer.getData("text/plain") || draggedInitiativeId;
                      const initiative = initiatives.find((item) => item.id === initiativeId);
                      if (!initiative) {
                        setDraggedInitiativeId(null);
                        setDropTargetStatus(null);
                        return;
                      }

                      void moveInitiativeToStatus(initiative, status);
                    }}
                  >
                    {visibleItems.length ? (
                      visibleItems.map((initiative) => {
                        const estimated = getEstimatedStatus(
                          initiative.est_start_date,
                          initiative.est_end_date,
                          initiative.status,
                        );
                        const spanLabel = getInitiativeSpanLabel(
                          initiative.est_start_date,
                          initiative.est_end_date,
                          initiative.subitems.length,
                        );
                        const inactiveDays =
                          initiative.status === "executing"
                            ? Math.ceil(
                                (new Date().getTime() -
                                  new Date(
                                    `${initiative.last_activity ?? toIsoDate()}T00:00:00`,
                                  ).getTime()) /
                                  (1000 * 60 * 60 * 24),
                              )
                            : 0;
                        const progressPercent = Math.max(
                          0,
                          Math.min(100, initiative.progressPercent ?? 0),
                        );

                        return (
                          <button
                            key={initiative.id}
                            type="button"
                            onClick={() => openEditModal(initiative)}
                            draggable={writable}
                            onDragStart={(event) => {
                              if (!writable) {
                                event.preventDefault();
                                return;
                              }
                              event.dataTransfer.setData("text/plain", initiative.id);
                              event.dataTransfer.effectAllowed = "move";
                              setDraggedInitiativeId(initiative.id);
                            }}
                            onDragOver={(event) => {
                              if (!writable || draggedInitiativeId === initiative.id) return;
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
                              if (!writable) return;
                              event.preventDefault();
                              event.stopPropagation();
                              const initiativeId =
                                event.dataTransfer.getData("text/plain") || draggedInitiativeId;
                              const draggedInitiative = initiatives.find((item) => item.id === initiativeId);

                              if (!draggedInitiative) {
                                setDraggedInitiativeId(null);
                                setDropTargetStatus(null);
                                setDropIndicator(null);
                                return;
                              }

                              void moveInitiativeToStatus(draggedInitiative, status, {
                                targetInitiativeId: initiative.id,
                                position: getDropPosition(event),
                              });
                            }}
                            onDragEnd={() => {
                              setDraggedInitiativeId(null);
                              setDropTargetStatus(null);
                              setDropIndicator(null);
                            }}
                            className={`relative w-full rounded-[4px] border border-[#dfe3eb] bg-white px-4 py-3 text-left shadow-sm transition hover:border-[#cbd6e2] hover:shadow ${
                              writable ? "cursor-grab active:cursor-grabbing" : ""
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
                            <div
                              className={`absolute left-0 top-0 h-full w-[3px] ${
                                status === "executing"
                                  ? "bg-[#00bda5]"
                                  : status === "planned"
                                    ? "bg-[#6a78d1]"
                                    : status === "completed"
                                      ? "bg-[#33475b]"
                                      : "bg-[#cbd6e2]"
                              }`}
                            />
                            <div className="absolute left-[3px] right-0 top-0 h-[3px] overflow-hidden rounded-tr-[4px] bg-[#eef2f7]">
                              <div
                                className={`h-full transition-all ${
                                  progressPercent >= 100
                                    ? "bg-[#33475b]"
                                    : progressPercent >= 60
                                      ? "bg-[#00bda5]"
                                      : progressPercent > 0
                                        ? "bg-[#6a78d1]"
                                        : "bg-[#cbd6e2]"
                                }`}
                                style={{ width: `${progressPercent}%` }}
                              />
                            </div>
                            <div className="min-w-0 pl-1">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <h4 className="text-[13px] font-bold leading-4 text-[#33475b]">
                                      {initiative.title}
                                    </h4>
                                    <span className="rounded-[2px] bg-[#f5f8fa] px-1.5 py-0.5 text-[9px] font-bold text-[#516f90]">
                                      {progressPercent}%
                                    </span>
                                  </div>
                                  <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-[#516f90]">
                                    {initiative.description || "Sin descripcion ejecutiva."}
                                  </p>
                                </div>
                              </div>

                              <div className="mt-3 space-y-1.5">
                                <div className="rounded-[2px] border border-[#cbd6e2] bg-[#f5f8fa] px-2 py-0.5 text-[9px] font-bold text-[#33475b]">
                                  {formatDateRange(initiative.est_start_date, initiative.est_end_date)}
                                  {estimated && estimated.label !== "Sin fechas" ? ` · ${estimated.label}` : ""}
                                </div>

                                {initiative.is_blocked ? (
                                  <div className="text-[9px] font-bold uppercase tracking-[0.08em] text-[#ef4444]">
                                    Bloqueada
                                  </div>
                                ) : initiative.status === "executing" && inactiveDays > RISK_INACTIVE_DAYS ? (
                                  <div className="text-[9px] font-bold text-[#ef4444]">
                                    Inactiva {inactiveDays} d
                                  </div>
                                ) : null}
                              </div>

                              {activeStage === "client" ? (
                                <div className="mt-3 rounded-[3px] border border-[#eaf0f6] bg-[#f8fbfd] p-2">
                                  <div className="mb-1 flex items-center justify-between gap-2">
                                    <span className="text-[9px] font-bold uppercase tracking-[0.08em] text-[#516f90]">
                                      Tareas
                                    </span>
                                    <span className="text-[9px] font-bold text-[#9cb1c6]">
                                      {initiative.subitems.length}
                                    </span>
                                  </div>
                                  {initiative.subitems.length ? (
                                    <div className="space-y-1">
                                      {initiative.subitems.slice(0, 3).map((subitem) => (
                                        <div
                                          key={subitem.id}
                                          className="flex items-center justify-between gap-2 rounded-[2px] bg-white px-2 py-1 text-[9px] text-[#33475b]"
                                        >
                                          <span className="truncate">{subitem.name}</span>
                                          <span className="shrink-0 text-[#9cb1c6]">
                                            {subitem.quantity} x {subitem.unit_credits}
                                          </span>
                                        </div>
                                      ))}
                                      {initiative.subitems.length > 3 ? (
                                        <p className="text-[9px] font-bold text-[#9cb1c6]">
                                          +{initiative.subitems.length - 3} tareas mas
                                        </p>
                                      ) : null}
                                    </div>
                                  ) : (
                                    <p className="text-[9px] text-[#9cb1c6]">
                                      Sin tareas visibles.
                                    </p>
                                  )}
                                </div>
                              ) : null}

                              <div className="mt-3 flex items-center justify-between border-t border-[#eaf0f6] pt-2">
                                <span className="text-[10px] font-bold text-[#9cb1c6]">
                                  {spanLabel}
                                </span>
                                <span className="rounded-[2px] bg-[#eaf0f6] px-1.5 py-0.5 text-[10px] font-bold text-[#33475b]">
                                  {initiative.credits} CR
                                </span>
                              </div>
                            </div>
                          </button>
                        );
                      })
                    ) : null}

                    {allowsQuickAdd ? (
                      <div className="mx-1 rounded-[4px] border border-dashed border-[#cbd6e2] bg-white p-1.5 shadow-sm">
                        <Select
                          value={quickAddSelections[status]}
                          onChange={(event) =>
                            setQuickAddSelections((current) => ({
                              ...current,
                              [status]: event.target.value,
                            }))
                          }
                          className="h-10 rounded-[3px] border-transparent px-3 py-2 text-[10px] font-medium leading-4 text-[#33475b] shadow-none"
                        >
                          <option value="">-- Rapido --</option>
                          {catalogOptions.map(([category, items]) => (
                            <optgroup key={category} label={category}>
                              {items.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.label} ({item.credits} CR)
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </Select>
                        <div className="mt-1.5 flex gap-1.5">
                          <Button
                            variant="secondary"
                            className="h-7 flex-1 rounded-[3px] border-[#cbd6e2] bg-white px-2 py-1 text-[10px] font-bold text-[#516f90]"
                            onClick={() => void quickAddInitiative(status)}
                            disabled={
                              isSavingInitiative ||
                              !quickAddSelections[status] ||
                              !canUseReservedStage(status)
                            }
                          >
                            Anadir
                          </Button>
                          <Button
                            variant="secondary"
                            className="h-7 rounded-[3px] border-[#cbd6e2] bg-white px-2 py-1 text-[10px] font-bold text-[#516f90]"
                            onClick={() => openGroupedDraft(status)}
                          >
                            Agrupar
                          </Button>
                        </div>
                      </div>
                    ) : !visibleItems.length ? (
                      <div className="rounded-[4px] border border-dashed border-[#cbd6e2] bg-white/70 p-4 text-[11px] text-[#9cb1c6]">
                        Vacio
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-3 flex gap-2">
                    {showsBottomCreateButton ? (
                      <Button
                        variant="secondary"
                        className="w-full rounded-[3px] border-2 border-dashed border-[#cbd6e2] bg-white px-3 py-2 text-[10px] font-bold text-[#516f90] transition hover:border-[#8fb3d9] hover:bg-[#f8fbff] hover:text-[#33475b]"
                        onClick={() => openCreateModal(status)}
                        disabled={!canUseReservedStage(status)}
                      >
                        <Plus className="mr-1.5 h-3.5 w-3.5" />
                        {status === "backlog"
                          ? "Anadir Caso de Uso a En evaluacion"
                          : "Anadir Caso de Uso Directo"}
                      </Button>
                    ) : null}
                    {status === "completed" && groupedInitiatives.completed.length > 6 ? (
                      <Button
                        variant="ghost"
                        className="rounded-[3px] px-2 py-2 text-[10px] font-bold text-[#516f90]"
                        onClick={() =>
                          setConfig((current) => ({
                            ...current,
                            show_all_completed: !current.show_all_completed,
                          }))
                        }
                      >
                        {config.show_all_completed ? "Ocultar" : "Ver todos"}
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          {activeStage === "cs" && writable ? (
            <div className="mt-4 flex min-w-max gap-4 px-1">
              <div className="w-[696px]">
                <Button
                  variant="primary"
                  className="w-full !rounded-[4px] !border-2 !border-dashed !border-[#00bda5] !bg-[#effdfa] px-6 py-4 !text-[16px] !font-bold !text-[#00bda5] !shadow-none transition hover:!border-[#00a894] hover:!bg-[#e6fcf8] hover:!text-[#00a894]"
                  onClick={() => openCatalogModal(defaultCatalogLibraryTab)}
                >
                  <Plus className="mr-2 h-5 w-5" />
                  Agregar Caso de Uso
                </Button>
              </div>
              <div className="w-[340px]" aria-hidden="true" />
              <div className="w-[340px]" aria-hidden="true" />
            </div>
          ) : null}
        </div>
      </section>

      <section className="bg-white px-6 py-10">
        <div className="mx-auto max-w-[1400px]">
          <div className="flex flex-col gap-4 border-b border-[#dfe3eb] pb-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-[20px] font-bold tracking-tight text-[#33475b]">
                <CalendarDays className="h-5 w-5 text-[#00bda5]" />
                <span>Plan de Trabajo</span>
              </h2>
              <p className="mt-2 text-[13px] text-[#516f90]">
                Proyeccion estrategica inicial. Puedes mover las iniciativas en el gantt y las fechas se sincronizan con su tarjeta.
              </p>
            </div>
            <Button
              variant="secondary"
              className="rounded-[3px] border-[#cbd6e2] bg-[#f5f8fa] px-3 py-2 text-[11px] font-bold text-[#516f90]"
              onClick={exportPdf}
              disabled={isExportingReport}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              {isExportingReport ? "Exportando..." : "Exportar Reporte"}
            </Button>
          </div>

          <div className="mt-6 overflow-x-auto pb-2">
            <div className="min-w-[1160px] overflow-hidden rounded-[6px] border border-[#dfe3eb] bg-white shadow-sm">
              <div
                className="grid min-w-[1120px]"
                style={{
                  gridTemplateColumns: `0px minmax(${ganttTimeline.timelineDays * ganttTimeline.dayWidth}px, 1fr)`,
                }}
              >
                <div className="overflow-hidden border-r-0 bg-white" />
                <div className="overflow-hidden border-b border-[#dfe3eb] bg-[#f5f8fa]">
                  <div className="grid" style={{ gridTemplateColumns: `repeat(3, minmax(0, 1fr))` }}>
                    {ganttTimeline.monthSegments.map((segment) => (
                      <div
                        key={segment.key}
                        className="border-r border-[#dfe3eb] px-3 py-2 text-[11px] font-bold capitalize text-[#516f90] last:border-r-0"
                      >
                        {segment.label}
                      </div>
                    ))}
                  </div>
                  <div
                    className="grid border-t border-[#dfe3eb] bg-white"
                    style={{ gridTemplateColumns: `repeat(${ganttTimeline.timelineDays}, ${ganttTimeline.dayWidth}px)` }}
                  >
                    {ganttTimeline.dayMarkers.map((marker) => (
                      <div
                        key={marker.key}
                        className="grid h-[24px] place-items-center border-r border-[#eef2f7] text-[8px] font-medium text-[#8aa0b4] last:border-r-0"
                      >
                        {marker.label}
                      </div>
                    ))}
                  </div>
                </div>

                {ganttTimeline.rows.length ? (
                  ganttTimeline.rows.map((row) => {
                    const baseStart = row.initiative.est_start_date ?? toIsoDate(row.start as Date);
                    const baseEnd = row.initiative.est_end_date ?? toIsoDate(row.end as Date);
                    const dragDelta =
                      ganttDrag?.initiativeId === row.initiative.id ? ganttDrag.dayDelta : 0;
                    const baseStartDate = parseCalendarDate(baseStart) ?? (row.start as Date);
                    const baseEndDate = parseCalendarDate(baseEnd) ?? (row.end as Date);
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
                      diffCalendarDays(ganttTimeline.windowStart, previewStartDate),
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
                              gridTemplateColumns: `repeat(${ganttTimeline.timelineDays}, ${ganttTimeline.dayWidth}px)`,
                            }}
                          >
                            {ganttTimeline.dayMarkers.map((marker) => (
                              <div
                                key={`${row.initiative.id}-${marker.key}`}
                                className="h-[30px] border-r border-b border-[#eef2f7] last:border-r-0"
                              />
                            ))}
                          </div>
                          {!row.isOutsideRange ? (
                            <div
                              className={`absolute top-[4px] h-[22px] rounded-[3px] ${getCustomerSuccessTimelineBarClass(
                                row.initiative.status,
                              )}`}
                              style={{
                                left: `${previewStartOffset * ganttTimeline.dayWidth}px`,
                                width: `${Math.max(previewSpan * ganttTimeline.dayWidth - 4, ganttTimeline.dayWidth * 6)}px`,
                                opacity: ganttDrag?.initiativeId === row.initiative.id ? 0.92 : 1,
                              }}
                            >
                              <div
                                onPointerDown={(event) => {
                                  if (!writable || isSavingInitiative) return;
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
                                onDoubleClick={() => openEditModal(row.initiative)}
                                className="absolute inset-y-0 left-3 right-3 z-0 flex cursor-grab items-center justify-center rounded-[3px] px-1 text-center active:cursor-grabbing"
                                title={writable ? "Arrastra para mover fechas. Doble clic para editar." : "Doble clic para ver detalle."}
                              >
                                <span className="truncate text-[8px] font-semibold leading-none">{row.initiative.title}</span>
                              </div>
                              {writable ? (
                                <button
                                  type="button"
                                  aria-label="Ajustar fecha de inicio"
                                  onPointerDown={(event) => {
                                    event.stopPropagation();
                                    event.preventDefault();
                                    if (isSavingInitiative) return;
                                    if (row.initiative.is_blocked) {
                                      showError("Esta iniciativa esta bloqueada. Debes desbloquearla antes de ajustar sus fechas.");
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
                              ) : null}
                              {writable ? (
                                <button
                                  type="button"
                                  aria-label="Ajustar fecha de fin"
                                  onPointerDown={(event) => {
                                    event.stopPropagation();
                                    event.preventDefault();
                                    if (isSavingInitiative) return;
                                    if (row.initiative.is_blocked) {
                                      showError("Esta iniciativa esta bloqueada. Debes desbloquearla antes de ajustar sus fechas.");
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
                              ) : null}
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
                ) : (
                  <>
                    <div className="border-r border-[#dfe3eb] px-3 py-4 text-[11px] text-[#9cb1c6]">
                      Sin rango
                    </div>
                    <div className="grid place-items-center border border-[#dfe3eb] border-l-0 px-4 py-10 text-center">
                      <p className="text-[12px] font-semibold text-[#516f90]">
                        Agrega fechas estimadas a las iniciativas para ver el gantt.
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>

            {ganttTimeline.undatedRows.length ? (
              <div className="mt-6 rounded-[6px] border border-dashed border-[#cbd6e2] bg-[#f8fbfd] px-4 py-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#516f90]">
                    Iniciativas sin rango
                  </h3>
                  <span className="rounded-full bg-[#f5f8fa] px-3 py-1 text-[10px] font-bold text-[#516f90]">
                    {ganttTimeline.undatedRows.length} pendientes
                  </span>
                </div>
                <p className="mt-2 text-[12px] text-[#8aa0b4]">
                  Aun no entran al calendario porque les falta fecha de inicio o fin.
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  {ganttTimeline.undatedRows.map((initiative) => (
                    <button
                      key={initiative.id}
                      type="button"
                      onClick={() => openEditModal(initiative)}
                      className="rounded-full border border-[#d7e0ea] bg-white px-4 py-2 text-[11px] text-[#33475b] shadow-[0_1px_2px_rgba(51,71,91,0.05)]"
                    >
                      <span className="font-bold">{initiative.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

        <div className="mt-10 space-y-4">
          <h3 className="text-[13px] font-bold text-[#33475b]">
            Desglose Analitico por Etapa
          </h3>

          {summaryStatuses.map((status) => {
            const items = groupedInitiatives[status];
            if (!items.length) return null;

            return (
              <div key={status} className="overflow-hidden rounded-[4px] border border-[#dfe3eb] bg-white">
                <div className="flex items-center justify-between gap-3 border-b border-[#dfe3eb] bg-[#f8fafc] px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className={`h-2.5 w-2.5 rounded-full ${getStatusDot(status)}`} />
                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#33475b]">
                      {STATUS_META[status].label}
                    </p>
                  </div>
                  <span className="rounded-[2px] bg-[#eaf0f6] px-2 py-0.5 text-[10px] font-bold text-[#516f90]">
                    {items.reduce((sum, initiative) => sum + initiative.credits, 0)} CR
                  </span>
                </div>

                <div className="divide-y divide-[#eaf0f6]">
                  {items.map((initiative) => (
                    <button
                      key={initiative.id}
                      type="button"
                      onClick={() => openEditModal(initiative)}
                      className="grid w-full gap-4 px-4 py-4 text-left transition hover:bg-[#fcfcfc] lg:grid-cols-[1.2fr_0.8fr]"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <h4 className="text-[12px] font-bold text-[#33475b]">{initiative.title}</h4>
                              {initiative.is_blocked ? (
                                <span className="rounded-[2px] bg-[#fee2e2] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#dc2626]">
                                  Bloqueado
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-1 text-[10px] text-[#516f90]">
                              {initiative.description || "Sin descripcion ejecutiva."}
                            </p>
                            <div className="mt-2 rounded-[2px] border border-[#cbd6e2] bg-[#f5f8fa] px-2 py-0.5 text-[9px] font-bold text-[#33475b]">
                              {formatDateRange(initiative.est_start_date, initiative.est_end_date)}
                            </div>
                          </div>
                          <span className="rounded-[2px] bg-[#eaf0f6] px-1.5 py-0.5 text-[9px] font-bold text-[#33475b]">
                            {initiative.credits} CR
                          </span>
                        </div>
                      </div>

                      <div className="rounded-[4px] border border-[#dfe3eb] bg-[#fcfcfc] p-3">
                        <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#516f90]">
                          Actividades incluidas
                        </p>
                        <div className="mt-2 space-y-1">
                          {initiative.subitems.map((subitem) => (
                            <div
                              key={subitem.id}
                              className="flex items-center justify-between gap-3 rounded-[3px] bg-white px-2 py-1.5 text-[10px] text-[#33475b]"
                            >
                              <span className="truncate">{subitem.name}</span>
                              <span className="shrink-0 text-[9px] text-[#516f90]">
                                {subitem.quantity} x {subitem.unit_credits} CR
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        </div>
      </section>

      <div id="report-export-root" className="pointer-events-none fixed left-[-200vw] top-0 z-[-1]">
        <div id="report-export-page-1" data-report-page="true" className="flex w-[1120px] min-h-[790px] flex-col bg-[#f5f8fa] px-10 py-8 text-[#33475b]">
          <div className="flex items-start justify-between border-b border-[#dfe3eb] pb-5">
            <div>
              <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-[#8aa0b4]">
                Everboarding Reporte
              </p>
              <h1 className="mt-3 text-[34px] font-bold tracking-[-0.03em] text-[#33475b]">
                Mapa Visual de Avance
              </h1>
              <p className="mt-2 text-[14px] text-[#516f90]">
                {client.name} · {formatLongDate(config.start_date)} · Vista {STAGE_META[activeStage].shortLabel}
              </p>
            </div>
            <div className="max-w-[320px] rounded-[14px] border border-[#dfe3eb] bg-white px-5 py-4 text-right">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#8aa0b4]">
                Contexto
              </p>
              <p className="mt-2 text-[13px] leading-6 text-[#516f90]">
                {client.description || "Roadmap operativo y ejecutivo del onboarding."}
              </p>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-4 gap-4">
            <div className="rounded-[14px] border border-[#d9eee9] bg-[#ecfffb] px-4 py-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#00a88f]">Disponibles</p>
              <p className="mt-2 text-[28px] font-bold text-[#00bda5]">{metrics.available} créditos</p>
            </div>
            <div className="rounded-[14px] border border-[#e2e5fb] bg-[#f2f4ff] px-4 py-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#5865c7]">Comprometidos</p>
              <p className="mt-2 text-[28px] font-bold text-[#6a78d1]">{metrics.reserved} créditos</p>
            </div>
            <div className="rounded-[14px] border border-[#dfe3eb] bg-white px-4 py-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#516f90]">Completados</p>
              <p className="mt-2 text-[28px] font-bold text-[#33475b]">{metrics.consumed} créditos</p>
            </div>
            <div className="rounded-[14px] border border-[#e5e7eb] bg-[#f8fafc] px-4 py-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#94a3b8]">Vigencia</p>
              <p className="mt-2 text-[28px] font-bold text-[#516f90]">{config.credit_validity_days} días</p>
            </div>
          </div>

          <div className="mt-6 h-[6px] overflow-hidden rounded-full bg-[#dfe3eb]">
            <div className="flex h-full w-full">
              <div style={{ width: `${progressParts.available}%` }} className="bg-[#00bda5]" />
              <div style={{ width: `${progressParts.reserved}%` }} className="bg-[#6a78d1]" />
              <div style={{ width: `${progressParts.consumed}%` }} className="bg-[#54779c]" />
              <div style={{ width: `${progressParts.lost}%` }} className="bg-[#33475b]" />
            </div>
          </div>

          <div className="relative mt-12 flex-1">
            <div className="absolute left-0 right-0 top-5 border-t border-[#dfe3eb]" />
            <div className="grid gap-8 grid-cols-4">
              {summaryStatuses.map((status) => {
                const items = groupedInitiatives[status];
                const topItem = items[0];
                const totalCredits = items.reduce((sum, initiative) => sum + initiative.credits, 0);

                return (
                  <div key={`report-map-${status}`} className="relative flex flex-col items-center text-center">
                    <div
                      className={`relative z-10 grid h-7 w-7 place-items-center rounded-full border-4 border-[#f5f8fa] ${
                        status === "executing"
                          ? "bg-[#00bda5]"
                          : status === "planned"
                            ? "bg-[#6a78d1]"
                            : status === "completed"
                              ? "bg-[#33475b]"
                              : "bg-[#54779c]"
                      }`}
                    />
                    <h3 className="mt-4 text-[13px] font-bold uppercase tracking-[0.12em] text-[#33475b]">
                      {STATUS_META[status].label}
                    </h3>
                    <p className="mt-1 text-[10px] font-bold text-[#9cb1c6]">
                      {status === "executing"
                        ? "Trabajo actual"
                        : status === "planned"
                          ? "Reservado"
                          : status === "backlog"
                            ? "Prioridades"
                            : "Exito"}
                    </p>
                    <span className="mt-2 rounded-[3px] border border-[#cbd6e2] bg-[#eaf0f6] px-2 py-1 text-[10px] font-bold text-[#516f90]">
                      {totalCredits} CR
                    </span>

                    <div className="mt-4 min-h-[120px] w-full rounded-[6px] border border-dashed border-[#dfe3eb] bg-white p-3 text-left">
                      {topItem ? (
                        <div>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-[11px] font-bold text-[#33475b]">{topItem.title}</p>
                              <p className="mt-1 text-[10px] text-[#516f90]">
                                {topItem.description || "Sin descripcion ejecutiva."}
                              </p>
                            </div>
                            <span className="rounded-[2px] bg-[#eaf0f6] px-1.5 py-0.5 text-[9px] font-bold text-[#33475b]">
                              {topItem.credits} CR
                            </span>
                          </div>
                          <div className="mt-3 rounded-[2px] border border-[#cbd6e2] bg-[#f5f8fa] px-2 py-0.5 text-[9px] font-bold text-[#33475b]">
                            {formatDateRange(topItem.est_start_date, topItem.est_end_date)}
                          </div>
                        </div>
                      ) : (
                        <p className="pt-6 text-center text-[10px] text-[#9cb1c6]">Sin iniciativas</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div id="report-export-page-2" data-report-page="true" className="flex w-[1120px] min-h-[790px] flex-col bg-[#f5f8fa] px-10 py-8 text-[#33475b]">
          <div className="border-b border-[#dfe3eb] pb-5">
            <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-[#8aa0b4]">
              Everboarding Reporte
            </p>
            <h1 className="mt-3 text-[34px] font-bold tracking-[-0.03em] text-[#33475b]">
              Desglose Analítico por Etapa
            </h1>
            <p className="mt-2 text-[14px] text-[#516f90]">
              Evolución estratégica y detalle operativo por cada fase del roadmap.
            </p>
          </div>

          <div className="mt-6 flex-1 space-y-5">
            {summaryStatuses.map((status) => {
              const items = groupedInitiatives[status];
              if (!items.length) return null;

              return (
                <div key={`report-breakdown-${status}`} className="overflow-hidden rounded-[8px] border border-[#dfe3eb] bg-white">
                  <div className="flex items-center justify-between gap-3 border-b border-[#dfe3eb] bg-[#f8fafc] px-5 py-3">
                    <div className="flex items-center gap-3">
                      <span className={`h-2.5 w-2.5 rounded-full ${getStatusDot(status)}`} />
                      <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-[#33475b]">
                        {STATUS_META[status].label}
                      </p>
                    </div>
                    <span className="rounded-[2px] bg-[#eaf0f6] px-2 py-0.5 text-[10px] font-bold text-[#516f90]">
                      {items.reduce((sum, initiative) => sum + initiative.credits, 0)} CR
                    </span>
                  </div>

                  <div className="divide-y divide-[#eaf0f6]">
                    {items.map((initiative) => (
                      <div key={`report-initiative-${initiative.id}`} className="grid gap-4 px-5 py-4 grid-cols-[1.3fr_0.7fr]">
                        <div>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <h4 className="text-[12px] font-bold text-[#33475b]">{initiative.title}</h4>
                                {initiative.is_blocked ? (
                                  <span className="rounded-[2px] bg-[#fee2e2] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#dc2626]">
                                    Bloqueado
                                  </span>
                                ) : null}
                              </div>
                              <p className="mt-1 text-[10px] text-[#516f90]">
                                {initiative.description || "Sin descripcion ejecutiva."}
                              </p>
                              <div className="mt-2 rounded-[2px] border border-[#cbd6e2] bg-[#f5f8fa] px-2 py-0.5 text-[9px] font-bold text-[#33475b]">
                                {formatDateRange(initiative.est_start_date, initiative.est_end_date)}
                              </div>
                            </div>
                            <span className="rounded-[2px] bg-[#eaf0f6] px-1.5 py-0.5 text-[9px] font-bold text-[#33475b]">
                              {initiative.credits} CR
                            </span>
                          </div>
                        </div>

                        <div className="rounded-[4px] border border-[#dfe3eb] bg-[#fcfcfc] p-3">
                          <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#516f90]">
                            Actividades incluidas
                          </p>
                          <div className="mt-2 space-y-1">
                            {initiative.subitems.length ? (
                              initiative.subitems.map((subitem) => (
                                <div
                                  key={`report-subitem-${subitem.id}`}
                                  className="flex items-center justify-between gap-3 rounded-[3px] bg-white px-2 py-1.5 text-[10px] text-[#33475b]"
                                >
                                  <span className="truncate">{subitem.name}</span>
                                  <span className="shrink-0 text-[9px] text-[#516f90]">
                                    {subitem.quantity} x {subitem.unit_credits} CR
                                  </span>
                                </div>
                              ))
                            ) : (
                              <div className="rounded-[3px] bg-white px-2 py-1.5 text-[10px] text-[#9cb1c6]">
                                Sin actividades desglosadas
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div id="report-export-page-3" data-report-page="true" className="flex w-[1120px] min-h-[790px] flex-col bg-[#f5f8fa] px-10 py-8 text-[#33475b]">
          <div className="border-b border-[#dfe3eb] pb-5">
            <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-[#8aa0b4]">
              Everboarding Reporte
            </p>
            <h1 className="mt-3 text-[34px] font-bold tracking-[-0.03em] text-[#33475b]">
              Resumen de Capacidad y Precios
            </h1>
            <p className="mt-2 text-[14px] text-[#516f90]">
              Estado del plan, vigencia de créditos y referencia económica del onboarding.
            </p>
          </div>

          <div className="mt-6 grid grid-cols-[1.1fr_0.9fr] gap-6">
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-[14px] border border-[#dfe3eb] bg-white p-5">
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#8aa0b4]">Cliente</p>
                  <p className="mt-2 text-[24px] font-bold text-[#33475b]">{client.name}</p>
                  <p className="mt-2 text-[12px] leading-6 text-[#516f90]">
                    {client.description || "Sin contexto adicional registrado."}
                  </p>
                </div>
                <div className="rounded-[14px] border border-[#dfe3eb] bg-white p-5">
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#8aa0b4]">Ciclo actual</p>
                  <p className="mt-2 text-[24px] font-bold text-[#33475b]">
                    {cycleDaysRemaining ?? 0} días
                  </p>
                  <p className="mt-2 text-[12px] leading-6 text-[#516f90]">
                    Corte estimado: {formatLongDate(metrics.cutoffDate)}
                  </p>
                </div>
              </div>

              <div className="rounded-[14px] border border-[#dfe3eb] bg-white p-5">
                <h3 className="text-[15px] font-bold text-[#33475b]">Capacidad consolidada</h3>
                <div className="mt-4 grid grid-cols-4 gap-3">
                  <div className="rounded-[10px] bg-[#ecfffb] p-4">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#00a88f]">Disponibles</p>
                    <p className="mt-2 text-[22px] font-bold text-[#00bda5]">{metrics.available}</p>
                  </div>
                  <div className="rounded-[10px] bg-[#f2f4ff] p-4">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#5865c7]">Reservados</p>
                    <p className="mt-2 text-[22px] font-bold text-[#6a78d1]">{metrics.reserved}</p>
                  </div>
                  <div className="rounded-[10px] bg-[#edf4fb] p-4">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#54779c]">Completados</p>
                    <p className="mt-2 text-[22px] font-bold text-[#54779c]">{metrics.consumed}</p>
                  </div>
                  <div className="rounded-[10px] bg-[#eef2f7] p-4">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#64748b]">Deducidos</p>
                    <p className="mt-2 text-[22px] font-bold text-[#33475b]">{metrics.lost}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-[14px] border border-[#dfe3eb] bg-white p-5">
                <h3 className="text-[15px] font-bold text-[#33475b]">Oferta actual</h3>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-[10px] border border-[#ff7a59] bg-[#fff3f0] px-4 py-4 text-center">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#8aa0b4]">
                      Creditos
                    </p>
                    <p className="mt-2 text-[24px] font-bold text-[#33475b]">{negotiatedPlanCredits} CR</p>
                    <p className="mt-1 text-[12px] text-[#516f90]">Oferta negociada</p>
                  </div>
                  <div className="rounded-[10px] border border-[#ff7a59] bg-[#fff3f0] px-4 py-4 text-center">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#8aa0b4]">
                      Precio
                    </p>
                    <p className="mt-2 text-[24px] font-bold text-[#33475b]">
                      {formatCurrency(negotiatedPlanPrice)}
                    </p>
                    <p className="mt-1 text-[12px] text-[#516f90]">{negotiatedPlanCadence}</p>
                  </div>
                </div>
              </div>

              <div className="rounded-[14px] border border-[#dfe3eb] bg-white p-5">
                <h3 className="text-[15px] font-bold text-[#33475b]">Configuración del onboarding</h3>
                <div className="mt-4 space-y-3 text-[13px] text-[#516f90]">
                  <div className="flex items-center justify-between rounded-[10px] bg-[#f8fafc] px-4 py-3">
                    <span>Créditos base</span>
                    <strong className="text-[#33475b]">{negotiatedPlanCredits} CR</strong>
                  </div>
                  <div className="flex items-center justify-between rounded-[10px] bg-[#f8fafc] px-4 py-3">
                    <span>Precio negociado</span>
                    <strong className="text-[#33475b]">
                      {formatCurrency(negotiatedPlanPrice)}
                    </strong>
                  </div>
                  <div className="flex items-center justify-between rounded-[10px] bg-[#f8fafc] px-4 py-3">
                    <span>Forma de cobro</span>
                    <strong className="text-[#33475b]">
                      {getPlanBillingModeLabel(negotiatedPlanBillingMode)}
                    </strong>
                  </div>
                  <div className="flex items-center justify-between rounded-[10px] bg-[#f8fafc] px-4 py-3">
                    <span>Vigencia de créditos</span>
                    <strong className="text-[#33475b]">{config.credit_validity_days} días</strong>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {isGeneratingWizardPlan ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#33475b]/72 p-6 backdrop-blur-sm">
          <div className="w-full max-w-[520px] rounded-[16px] border border-white/60 bg-white px-8 py-9 text-center shadow-[0_24px_70px_rgba(15,23,42,0.28)]">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#ecfffb] text-[#14b8a6] shadow-[0_10px_30px_rgba(20,184,166,0.18)]">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>

            <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.22em] text-[#8aa0b4]">
              Guía de Activación
            </p>
            <h3 className="mt-2 text-[24px] font-extrabold tracking-[-0.02em] text-[#33475b]">
              Armando tu Plan de Trabajo
            </h3>
            <p className="mt-3 text-[15px] font-semibold text-[#14b8a6]">
              {wizardLoadingMessage}
            </p>
            <p className="mt-2 text-[12px] leading-6 text-[#516f90]">
              Estamos organizando una recomendación alineada al contexto y a los créditos disponibles.
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

      {isUpsellModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#33475b]/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-[640px] rounded-[6px] border border-[#dfe3eb] bg-white p-6 shadow-2xl">
            <div className="text-center">
              <h3 className="text-[18px] font-bold text-[#33475b]">Incremento de Capacidad</h3>
              <p className="mt-2 text-[13px] text-[#516f90]">
                Añade paquetes adicionales de créditos a tu plan actual.
              </p>
            </div>

            <div className="mt-6 space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <div className="flex-1">
                  <select
                    value={String(selectedUpsellCredits)}
                    onChange={(event) => setSelectedUpsellCredits(safeParseNumber(event.target.value))}
                    className="h-9 w-full rounded-[2px] border border-[#cbd6e2] bg-white px-3 text-[13px] font-bold text-[#33475b] outline-none transition focus:border-[#00bda5]"
                  >
                    {CS_UPSELL_CREDIT_OPTIONS.map((option) => (
                      <option key={`cs-upsell-${option}`} value={option}>
                        {option} créditos
                      </option>
                    ))}
                    <option value={-1}>Personalizado</option>
                  </select>
                  {selectedUpsellCredits === -1 ? (
                    <Input
                      type="number"
                      min="1"
                      value={customUpsellCredits}
                      onChange={(event) => setCustomUpsellCredits(event.target.value)}
                      className="mt-3 h-9 rounded-[2px] border-[#cbd6e2] bg-white px-3 text-[13px] font-bold"
                      placeholder="Créditos personalizados"
                    />
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => setUpsellQuantity((current) => current + 1)}
                  className="inline-flex h-9 items-center justify-center rounded-[4px] bg-[#14b8a6] px-5 text-[13px] font-bold text-white transition hover:bg-[#0ea899]"
                >
                  + Añadir
                </button>
              </div>
              <p className="text-[12px] text-[#516f90]">
                Opciones disponibles para CS: 40, 60, 80 o un valor personalizado.
              </p>
            </div>

            <div className="mt-5 rounded-[4px] border border-[#99f6e4] bg-[#f0fdfa] p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#00bda5]">
                Resumen de capacidad
              </p>

              <div className="mt-4 space-y-3 text-[13px] text-[#33475b]">
                <div className="flex items-center justify-between gap-4">
                  <span className="font-bold">Capacidad actual:</span>
                  <span className="font-bold">{metrics.total} CR</span>
                </div>

                {upsellQuantity > 0 ? (
                  <div className="flex items-center justify-between gap-4">
                    <button
                      type="button"
                      onClick={() => setUpsellQuantity((current) => Math.max(0, current - 1))}
                      className="mr-1 text-[16px] font-bold text-[#9cb1c6] transition hover:text-[#ef4444]"
                    >
                      ×
                    </button>
                    <span className="flex-1">
                      {upsellQuantity}x Paquete {getResolvedUpsellCredits()} CR
                    </span>
                    <span className="font-bold">{getResolvedUpsellCredits() * upsellQuantity} CR</span>
                  </div>
                ) : (
                  <p className="text-[12px] text-[#516f90]">
                    Aún no has agregado paquetes a este incremento.
                  </p>
                )}

                <div className="border-t border-[#99f6e4] pt-3">
                  <div className="flex items-center justify-between gap-4 text-[14px] font-bold text-[#00bda5]">
                    <span>Créditos extra acumulados:</span>
                    <span>{currentExtraCapacityCredits + getResolvedUpsellCredits() * upsellQuantity} CR</span>
                  </div>
                </div>

                <div className="border-t border-[#99f6e4] pt-3">
                  <div className="flex items-center justify-between gap-4 text-[15px] font-extrabold">
                    <span className="text-[#33475b]">Capacidad total resultante:</span>
                    <span className="text-[#ff7a59]">
                      {metrics.total + getResolvedUpsellCredits() * upsellQuantity} CR
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
              <button
                type="button"
                onClick={confirmUpsellCredits}
                className="inline-flex h-10 flex-1 items-center justify-center rounded-[4px] bg-[#14b8a6] px-4 text-[13px] font-bold text-white transition hover:bg-[#0ea899]"
              >
                Aplicar paquetes
              </button>
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

              <div className="min-h-0 flex-1 overflow-y-auto bg-[#f5f8fa] p-6">
                {activeCatalogTab === "wizard" ? (
                  <div className="relative mx-auto max-w-[770px] rounded-[8px] border border-[#dfe3eb] bg-white p-8 shadow-sm">
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
                          {["Sales", "Marketing", "Service", "Content"].map((hub) => {
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
                      </div>

                      <div>
                        <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-[#516f90]">
                          2. ¿Cuál es la situación actual del portal?
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
                                <p className="text-[13px] font-bold text-[#33475b]">
                                  Estamos arrancando desde cero
                                </p>
                                <p className="mt-1 text-[11px] text-[#516f90]">
                                  Necesitamos fundamentos, estructura y un primer plan de activación.
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
                          3. Comparte el contexto comercial o de operación
                        </p>
                        <div className="mt-4">
                          <textarea
                            rows={5}
                            value={wizardContext}
                            onChange={(event) => setWizardContext(event.target.value)}
                            placeholder="Ejemplo: el cliente ya usa HubSpot Sales, quiere ordenar su pipeline, priorizar marketing y distribuir mejor los créditos del ciclo."
                            className="w-full rounded-[8px] border-2 border-[#cbd6e2] bg-white px-4 py-3 text-[13px] text-[#33475b] outline-none transition placeholder:text-[#9cb1c6] focus:border-[#14b8a6]"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="mt-10 flex justify-center pt-6">
                      <button
                        type="button"
                        onClick={() => void applyWizardRecommendations()}
                        disabled={!wizardHubs.length || isGeneratingWizardPlan}
                        className="inline-flex items-center gap-2 rounded-[6px] bg-[#14b8a6] px-10 py-3.5 text-[15px] font-bold text-white shadow-md transition hover:bg-[#0ea899] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Sparkles className="h-4 w-4" />
                        {isGeneratingWizardPlan ? "Cargando..." : "Armar Plan de Trabajo"}
                      </button>
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
                      const alreadyAdded = initiatives.some(
                        (initiative) => normalizeCatalogText(initiative.title) === normalizeCatalogText(group.name),
                      );

                      return (
                        <div
                          key={group.id}
                          role={alreadyAdded ? undefined : "button"}
                          tabIndex={alreadyAdded ? -1 : 0}
                          onClick={() => {
                            if (!alreadyAdded) openCatalogGroupPreview(group);
                          }}
                          onKeyDown={(event) => {
                            if (!alreadyAdded && (event.key === "Enter" || event.key === " ")) {
                              event.preventDefault();
                              openCatalogGroupPreview(group);
                            }
                          }}
                          className={`flex h-full min-h-[320px] flex-col rounded-[6px] border p-5 text-left shadow-sm transition ${
                            alreadyAdded
                              ? "cursor-default border-[#d7dee8] bg-[#f3f5f7]"
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
                            <span
                              className={`rounded-[2px] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] ${
                                alreadyAdded ? "bg-[#e7edf3] text-[#7c8da1]" : "bg-[#f5f8fa] text-[#516f90]"
                              }`}
                            >
                              {group.items.length ? `${group.items.length} tareas` : "Grupo manual"}
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
                              {group.description || "Grupo sugerido desde el catálogo para incluirlo dentro del plan de trabajo."}
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
                              {alreadyAdded ? (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void removeCatalogGroup(group);
                                  }}
                                  className="rounded-[3px] border border-[#fecaca] bg-white px-2.5 py-1 text-[10px] font-bold text-[#dc2626] transition hover:border-[#fca5a5] hover:bg-[#fff5f5]"
                                >
                                  Quitar
                                </button>
                              ) : (
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
                              )}
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
              <section>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#9cb1c6]">
                  Alcance y descripción detallada
                </p>
                <div className="mt-3 rounded-[6px] border border-[#dfe3eb] bg-white p-5 shadow-sm">
                  <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[#33475b]">
                    {catalogPreviewGroup.description || "Este grupo no tiene descripción detallada todavía."}
                  </p>
                </div>
              </section>

              <section>
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
                      Este grupo no tiene tareas asociadas; usa una carga manual de créditos.
                    </p>
                  )}
                </div>
              </section>

              <section className="rounded-[6px] border border-[#99f6e4] bg-[#f0fdfa] px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[12px] font-bold uppercase tracking-[0.08em] text-[#00bda5]">
                    Consumo de créditos:
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
                  onClick={() => void addCatalogGroupInitiative(catalogPreviewGroup, "planned")}
                  disabled={isSavingInitiative}
                  className="flex w-full flex-col items-center justify-center rounded-[6px] bg-[#14b8a6] px-5 py-4 text-white shadow-md transition hover:bg-[#0ea899] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="text-[14px] font-extrabold">Incluir en Planificación</span>
                  <span className="mt-1 text-[11px] font-medium opacity-90">
                    Consumirá {catalogPreviewGroup.credits} CR
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void addCatalogGroupInitiative(catalogPreviewGroup, "backlog")}
                  disabled={isSavingInitiative}
                  className="flex w-full flex-col items-center justify-center rounded-[6px] bg-[#5f7ea2] px-5 py-4 text-white shadow-md transition hover:bg-[#4f6f92] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="text-[14px] font-extrabold">Dejar en Evaluación</span>
                  <span className="mt-1 text-[11px] font-medium opacity-90">
                    No consumirá créditos por ahora
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void addCatalogGroupInitiative(catalogPreviewGroup, "executing")}
                  disabled={isSavingInitiative}
                  className="flex w-full flex-col items-center justify-center rounded-[6px] bg-[#33475b] px-5 py-4 text-white shadow-md transition hover:bg-[#243444] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="text-[14px] font-extrabold">Agregar como Ejecutando</span>
                  <span className="mt-1 text-[11px] font-medium opacity-90">
                    Lo moveremos directo a trabajo en curso
                  </span>
                </button>
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      {isOfferModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6 backdrop-blur-sm">
          <Card className="w-full max-w-2xl rounded-[24px] border border-slate-200 bg-white p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Configurar oferta
                </p>
                <h3 className="mt-2 text-2xl font-semibold text-slate-950">
                  Define una oferta libre para este cliente, sin paquetes fijos.
                </h3>
              </div>
              <Button variant="ghost" onClick={() => setIsOfferModalOpen(false)}>
                Cerrar
              </Button>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-700">Creditos contratados</span>
                <Input
                  type="number"
                  min={1}
                  value={offerDraft.credits}
                  onChange={(event) =>
                    setOfferDraft((current) => ({
                      ...current,
                      credits: Math.max(1, safeParseNumber(event.target.value)),
                    }))
                  }
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-700">Periodo de compra</span>
                <Select
                  value={String(offerDraft.periodMonths)}
                  onChange={(event) =>
                    setOfferDraft((current) => ({
                      ...current,
                      periodMonths: safeParseNumber(event.target.value) as PlanPeriodMonths,
                    }))
                  }
                >
                  <option value="1">Mensual</option>
                  <option value="3">Trimestre</option>
                  <option value="6">Semestre</option>
                  <option value="12">Anual</option>
                </Select>
              </label>

              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-700">Precio negociado</span>
                <Input
                  type="number"
                  min={0}
                  value={offerDraft.price}
                  onChange={(event) =>
                    setOfferDraft((current) => ({
                      ...current,
                      price: Math.max(0, safeParseNumber(event.target.value)),
                    }))
                  }
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-700">Forma de cobro</span>
                <Select
                  value={offerDraft.billingMode}
                  onChange={(event) =>
                    setOfferDraft((current) => ({
                      ...current,
                      billingMode: event.target.value as CustomPlanBillingMode,
                    }))
                  }
                >
                  <option value="subscription">Membresia recurrente</option>
                  <option value="one_time">Paquete unico</option>
                </Select>
              </label>

              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-700">Vigencia de creditos</span>
                <Input
                  type="number"
                  min={1}
                  value={offerDraft.validityDays}
                  onChange={(event) =>
                    setOfferDraft((current) => ({
                      ...current,
                      validityDays: Math.max(1, safeParseNumber(event.target.value)),
                    }))
                  }
                />
              </label>
            </div>

            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              <p>
                Oferta negociada: <strong>{offerDraft.credits} CR</strong> por{" "}
                <strong>{getPlanPeriodLabel(offerDraft.periodMonths)}</strong> ·{" "}
                <strong>
                  {getMonthlyContractCredits({
                    base_capacity: offerDraft.credits,
                    custom_plan_credits: offerDraft.credits,
                    custom_plan_period_months: offerDraft.periodMonths,
                  })}{" "}
                  CR/mes
                </strong>{" "}
                · <strong>{formatCurrency(offerDraft.price)}</strong> · vigencia de{" "}
                <strong>{offerDraft.validityDays} dias</strong>.
              </p>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <Button onClick={applyOfferDraft}>Aplicar oferta</Button>
              <Button variant="secondary" onClick={() => setOfferDraft((current) => ({
                ...current,
                price: suggestPlanPrice(current.credits),
              }))}>
                Usar referencia sugerida
              </Button>
              <Button variant="ghost" onClick={() => setIsOfferModalOpen(false)}>
                Cancelar
              </Button>
            </div>
          </Card>
        </div>
      ) : null}

      {isClearModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6 backdrop-blur-sm">
          <Card className="w-full max-w-xl rounded-[24px] border border-slate-200 bg-white p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Limpiar board
                </p>
                <h3 className="mt-2 text-2xl font-semibold text-slate-950">
                  Esta acción eliminará todas las iniciativas del onboarding.
                </h3>
              </div>
              <Button variant="ghost" onClick={() => setIsClearModalOpen(false)}>
                Cerrar
              </Button>
            </div>

            <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm leading-6 text-rose-700">
              Se borrarán las tareas del board en todas las etapas, junto con sus actividades y
              notas asociadas. Esta acción no se puede deshacer.
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <Button variant="danger" onClick={clearBoard} disabled={isClearingBoard}>
                {isClearingBoard ? "Limpiando..." : "Sí, limpiar board"}
              </Button>
              <Button variant="secondary" onClick={() => setIsClearModalOpen(false)} disabled={isClearingBoard}>
                Cancelar
              </Button>
            </div>
          </Card>
        </div>
      ) : null}

      {draft ? (
        <div className="fixed inset-0 z-50 bg-[#33475b]/60 backdrop-blur-[2px]">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Cerrar panel"
            onClick={() => setDraft(null)}
          />
          <aside className="absolute inset-y-0 right-0 flex w-full max-w-[760px] flex-col border-l border-[#dfe3eb] bg-white shadow-[-16px_0_40px_rgba(51,71,91,0.12)]">
            <div
              className={`border-b border-[#dfe3eb] bg-[#f5f8fa] px-6 pb-5 pt-6 ${
                draft.isBlocked ? "border-l-4 border-l-[#ef4444] pl-5" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <span
                    className={`inline-flex rounded-[2px] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${getPanelStatusBadgeClass(
                      draft.status,
                    )}`}
                  >
                    {STATUS_META[draft.status].label}
                  </span>
                  <textarea
                    rows={2}
                    value={draft.title}
                    onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                    disabled={!writable}
                    placeholder="Titulo"
                    spellCheck={false}
                    className="mt-4 block w-full resize-none border-0 bg-transparent p-0 text-[22px] font-black leading-[1.1] text-[#33475b] outline-none"
                    style={{
                      border: "none",
                      background: "transparent",
                      boxShadow: "none",
                      borderRadius: 0,
                      fontWeight: 900,
                      fontFamily: "inherit",
                      color: "#33475b",
                    }}
                  />
                </div>

                <div className="flex items-start gap-2 pt-1">
                  {writable ? (
                    <button
                      type="button"
                      onClick={() => setDraft({ ...draft, isBlocked: !draft.isBlocked })}
                      className={`rounded-[2px] border px-2 py-[4px] text-[8px] font-bold uppercase tracking-[0.05em] transition ${
                        draft.isBlocked
                          ? "border-[#fecaca] bg-[#fff1f2] text-[#ef4444] hover:border-[#fda4af]"
                          : "border-[#cbd6e2] bg-white text-[#33475b] hover:border-[#9cb1c6]"
                      }`}
                    >
                      {draft.isBlocked ? "Desbloquear" : "Bloquear"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setDraft(null)}
                    className="rounded-[2px] p-1 text-[#9cb1c6] transition hover:bg-white hover:text-[#33475b]"
                    aria-label="Cerrar panel"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="mt-6 border-t border-dashed border-[#dfe3eb] pt-6">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#516f90]">Mover a:</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {boardStatuses
                    .filter((status) => status !== draft.status)
                    .map((status) => (
                      <button
                        key={status}
                        type="button"
                        onClick={() => setDraft({ ...draft, status })}
                        disabled={!writable}
                        className="rounded-[2px] border border-[#cbd6e2] bg-white px-2.5 py-[5px] text-[10px] font-bold text-[#33475b] transition hover:border-[#9cb1c6] hover:bg-[#f8fbff] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {STATUS_META[status].label}
                      </button>
                    ))}
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto bg-white px-6 py-6">
              <div className="space-y-6">
                <div className="grid gap-6">
                  <section className="min-w-0 rounded-[4px] border border-[#dfe3eb] bg-[#fcfcfc] p-4">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#516f90]">
                      Rango estimado
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
                      <Input
                        type="date"
                        value={draft.estStartDate}
                        onChange={(event) => setDraft({ ...draft, estStartDate: event.target.value })}
                        disabled={!writable}
                        className="h-9 min-w-0 rounded-none border-[#cbd6e2] bg-white px-3 text-[12px] text-[#33475b] shadow-none"
                        style={{ borderRadius: 0, boxShadow: "none" }}
                      />
                      <span className="text-[11px] font-bold text-[#516f90] sm:text-center">al</span>
                      <Input
                        type="date"
                        value={draft.estEndDate}
                        onChange={(event) => setDraft({ ...draft, estEndDate: event.target.value })}
                        disabled={!writable}
                        className="h-9 min-w-0 rounded-none border-[#cbd6e2] bg-white px-3 text-[12px] text-[#33475b] shadow-none"
                        style={{ borderRadius: 0, boxShadow: "none" }}
                      />
                    </div>
                  </section>

                  <section className="min-w-0 rounded-[4px] border border-[#d9e6f2] bg-[#f8fbff] p-4 shadow-[0_8px_24px_rgba(81,111,144,0.08)]">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#516f90]">
                      Descripcion
                    </p>
                    {writable ? (
                      <Textarea
                        rows={7}
                        value={draft.description}
                        onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                        className="mt-3 min-h-[220px] resize-y rounded-none border-[#cbd6e2] bg-white px-4 py-3 text-[13px] leading-6 text-[#33475b] shadow-none"
                        style={{ borderRadius: 0, boxShadow: "none" }}
                      />
                    ) : (
                      <div className="mt-3 min-h-[220px] whitespace-pre-wrap rounded-none border border-[#cbd6e2] bg-white px-4 py-3 text-[13px] leading-6 text-[#33475b]">
                        {draft.description?.trim() || "Sin descripcion ejecutiva."}
                      </div>
                    )}
                  </section>
                </div>

                <section className="rounded-[4px] border border-[#dfe3eb] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#516f90]">
                      Actividades incluidas
                    </p>
                    <span className="text-[13px] font-bold text-[#ff7a59]">
                      {calculateCredits(
                        draft.subitems.map((subitem) => ({
                          unit_credits: subitem.unitCredits,
                          quantity: subitem.quantity,
                        })),
                      )}{" "}
                      CR
                    </span>
                  </div>

                  <div className="mt-4 space-y-3">
                    {draft.subitems.map((subitem, index) => (
                      <div
                        key={subitem.id ?? `draft-subitem-${index}`}
                        className="rounded-[4px] border border-[#dfe3eb] bg-[#f5f8fa] p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <textarea
                              rows={2}
                              value={subitem.name}
                              onChange={(event) =>
                                updateDraftSubitem(index, "name", event.target.value)
                              }
                              placeholder="Actividad"
                              className="block w-full resize-none border-0 bg-transparent p-0 text-[12px] font-bold leading-[1.25] text-[#33475b] outline-none"
                              style={{ border: "none", background: "transparent", boxShadow: "none", borderRadius: 0 }}
                              disabled={!writable}
                            />
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <span className="text-[9px] text-[#516f90]">{subitem.unitCredits} CR c/u</span>
                              <button
                                type="button"
                                onClick={() =>
                                  writable &&
                                  updateDraftSubitem(index, "status", getNextTaskStatus(subitem.status))
                                }
                                disabled={!writable}
                                className={`inline-flex items-center rounded-[999px] px-2 py-1 text-[9px] font-bold transition disabled:cursor-not-allowed disabled:opacity-70 ${TASK_STATUS_META[subitem.status].muted}`}
                              >
                                {TASK_STATUS_META[subitem.status].label}
                              </button>
                              {(() => {
                                const dateInputId = `draft-subitem-date-${draft.id || "new"}-${index}`;

                                return (
                                  <div className="relative inline-flex">
                                    <button
                                      type="button"
                                      disabled={!writable}
                                      onClick={() => {
                                        if (!writable) return;

                                        const input = draftSubitemDateInputRefs.current[dateInputId];
                                        if (!input) return;

                                        if (typeof input.showPicker === "function") {
                                          input.showPicker();
                                          return;
                                        }

                                        input.focus();
                                        input.click();
                                      }}
                                      className="inline-flex items-center gap-1 rounded-[999px] border border-[#cbd6e2] bg-white px-2 py-1 text-[9px] font-medium text-[#516f90] transition hover:border-[#9cb1c6] disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                      <CalendarDays className="h-3 w-3" />
                                      {formatCompactDate(subitem.targetDate)}
                                    </button>
                                    {writable ? (
                                      <input
                                        id={dateInputId}
                                        ref={(element) => {
                                          draftSubitemDateInputRefs.current[dateInputId] = element;
                                        }}
                                        type="date"
                                        value={subitem.targetDate}
                                        onChange={(event) =>
                                          updateDraftSubitem(index, "targetDate", event.target.value)
                                        }
                                        className="pointer-events-none absolute inset-0 z-10 h-full w-full opacity-0"
                                        tabIndex={-1}
                                        aria-hidden="true"
                                        aria-label={`Fecha objetivo de ${subitem.name || `actividad ${index + 1}`}`}
                                      />
                                    ) : null}
                                  </div>
                                );
                              })()}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 pl-2">
                            <button
                              type="button"
                              onClick={() =>
                                updateDraftSubitem(index, "quantity", String(Math.max(1, subitem.quantity - 1)))
                              }
                              disabled={!writable}
                              className="grid h-7 w-7 place-items-center rounded-none border border-[#cbd6e2] border-r-0 bg-white text-[13px] font-bold text-[#33475b] disabled:opacity-60"
                            >
                              -
                            </button>
                            <span className="flex h-7 min-w-[18px] items-center justify-center border-y border-[#cbd6e2] bg-white px-1 text-center text-[10px] font-bold text-[#33475b]">
                              {subitem.quantity}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                updateDraftSubitem(index, "quantity", String(subitem.quantity + 1))
                              }
                              disabled={!writable}
                              className="grid h-7 w-7 place-items-center rounded-none border border-[#cbd6e2] border-l-0 bg-white text-[13px] font-bold text-[#33475b] disabled:opacity-60"
                            >
                              +
                            </button>
                            <button
                              type="button"
                              onClick={() => removeDraftSubitem(index)}
                              disabled={!writable}
                              className="ml-1 grid h-6 w-6 place-items-center text-[#ef4444] transition hover:text-[#dc2626] disabled:opacity-60"
                              aria-label="Quitar actividad"
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
                      value={catalogSelection}
                      onChange={(event) => setCatalogSelection(event.target.value)}
                      disabled={!writable}
                      className="h-8 w-full appearance-none border border-[#cbd6e2] bg-white px-3 text-[10px] text-[#33475b] outline-none"
                      style={{ borderRadius: 0, boxShadow: "none" }}
                    >
                      <option value="">{"-- A\u00f1adir --"}</option>
                      {catalogOptions.map(([category, items]) => (
                        <optgroup key={category} label={category}>
                          {items.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.label} ({item.credits} CR)
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={addCatalogItem}
                      disabled={!writable}
                      className="h-8 rounded-[2px] border border-[#cbd6e2] bg-white px-3 text-[10px] font-bold text-[#33475b] transition hover:bg-[#f5f8fa] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {"A\u00f1adir"}
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={addManualSubitem}
                    disabled={!writable}
                    className="mt-4 inline-flex items-center gap-1.5 text-[10px] font-semibold text-[#516f90] transition hover:text-[#33475b] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Plus className="h-3 w-3" />
                    Actividad personalizada
                  </button>

                  <div className="mt-4 flex items-center justify-between border-t border-[#dfe3eb] pt-3">
                    <p className="text-[12px] font-bold uppercase tracking-[0.08em] text-[#33475b]">
                      Costo total:
                    </p>
                    <p className="text-[14px] font-bold text-[#ff7a59]">
                      {calculateCredits(
                        draft.subitems.map((subitem) => ({
                          unit_credits: subitem.unitCredits,
                          quantity: subitem.quantity,
                        })),
                      )}{" "}
                      CR
                    </p>
                  </div>
                </section>

                <section className="rounded-[4px] border border-[#dfe3eb] bg-[#fcfcfc] p-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#516f90]">Cliente</p>
                      <div className="mt-2 border-b border-dashed border-[#00bda5] pb-1">
                        <input
                          value={draft.ownerClient}
                          onChange={(event) => setDraft({ ...draft, ownerClient: event.target.value })}
                          disabled={!writable}
                          placeholder="Cliente"
                          className="h-6 w-full border-0 bg-transparent p-0 text-[12px] font-semibold text-[#33475b] outline-none placeholder:text-[#9cb1c6] disabled:cursor-not-allowed"
                          style={{ border: "none", background: "transparent", boxShadow: "none", borderRadius: 0 }}
                        />
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#516f90]">CSM</p>
                      <div className="mt-2 border-b border-dashed border-[#00bda5] pb-1">
                        <input
                          value={draft.ownerCSM}
                          onChange={(event) => setDraft({ ...draft, ownerCSM: event.target.value })}
                          disabled={!writable}
                          placeholder="CSM"
                          className="h-6 w-full border-0 bg-transparent p-0 text-[12px] font-semibold text-[#33475b] outline-none placeholder:text-[#9cb1c6] disabled:cursor-not-allowed"
                          style={{ border: "none", background: "transparent", boxShadow: "none", borderRadius: 0 }}
                        />
                      </div>
                    </div>
                  </div>
                </section>

                <section className="border-t border-[#dfe3eb] pt-5">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#516f90]">Historial</p>
                  <div className="mt-3 rounded-[4px] border border-[#dfe3eb] bg-[#fcfcfc] p-3">
                    <Textarea
                      rows={2}
                      placeholder="Nueva nota..."
                      value={draft.note}
                      onChange={(event) => setDraft({ ...draft, note: event.target.value })}
                      disabled={!writable}
                      className="rounded-none border-[#cbd6e2] bg-white text-[12px] text-[#516f90] shadow-none"
                      style={{ borderRadius: 0, boxShadow: "none" }}
                    />
                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        onClick={saveInitiative}
                        disabled={!writable || isSavingInitiative}
                        className="h-8 rounded-[2px] border border-[#cbd6e2] bg-white px-3 text-[10px] font-bold text-[#33475b] transition hover:bg-[#f5f8fa] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Guardar
                      </button>
                    </div>
                  </div>
                  {currentEditingInitiative?.logs.length ? (
                    <div className="mt-3 space-y-2">
                      {currentEditingInitiative.logs.map((log) => (
                        <div key={log.id} className="rounded-[4px] border border-[#dfe3eb] bg-white px-3 py-2">
                          <p className="text-[10px] font-semibold text-[#9cb1c6]">{formatDate(log.created_at)}</p>
                          <p className="mt-1 text-[12px] leading-5 text-[#516f90]">{log.entry}</p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </section>
              </div>
            </div>

            <div className="border-t border-[#dfe3eb] bg-white px-4 py-4">
              <div className="flex items-center gap-3">
                {writable ? (
                  <button
                    type="button"
                    onClick={saveInitiative}
                    disabled={isSavingInitiative}
                    className={`inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-[2px] border px-3 text-[10px] font-bold transition ${
                      isSavingInitiative || isDraftModified
                        ? "border-[#ff7a59] bg-[#ff7a59] text-white hover:bg-[#ea6d4f]"
                        : "border-[#dfe3eb] bg-[#f5f8fa] text-[#9cb1c6] hover:bg-[#eef3f7]"
                    }`}
                  >
                    {isSavingInitiative ? "Guardando..." : "Guardado"}
                  </button>
                ) : (
                  <div className="flex flex-1 items-center gap-2 rounded-[3px] border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-700">
                    <AlertTriangle className="h-4 w-4" />
                    Este onboarding esta en modo solo lectura.
                  </div>
                )}
                {editingInitiativeId && writable ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (currentEditingInitiative) void deleteInitiative(currentEditingInitiative);
                    }}
                    className="grid h-8 w-8 place-items-center rounded-[2px] border border-[#fecaca] bg-white text-[#ef4444] transition hover:bg-[#fff1f2]"
                    aria-label="Eliminar iniciativa"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setDraft(null)}
                  className="grid h-8 w-8 place-items-center rounded-[2px] border border-[#fecaca] bg-white text-[#ef4444] transition hover:bg-[#fff1f2]"
                  aria-label="Cerrar panel"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      <FeedbackToast feedback={feedback} onClose={() => setFeedback(null)} />
    </div>
  );
}
