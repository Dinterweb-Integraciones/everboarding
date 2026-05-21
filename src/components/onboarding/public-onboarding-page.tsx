"use client";

import { CalendarDays, CreditCard, Plus, ShieldCheck, Sparkles, X } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";

import { BrandLogo } from "@/components/layout/brand-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FeedbackToast } from "@/components/ui/feedback-toast";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PUBLIC_EXTRA_CREDIT_PACKAGE, STATUS_META, STAGE_META } from "@/lib/constants";
import {
  buildCatalogGroupOptions,
  buildCatalogModalGroups,
  calculateMetrics,
  formatDateRange,
  getEstimatedStatus,
  getPlanCadenceLabel,
  resolveStageFromPublicAudience,
  suggestPlanPrice,
  type CatalogModalGroup,
  type ClientBillingStatus,
  type InitiativeRecord,
  type InitiativeStatus,
  type PublicOnboardingAudience,
  type PublicOnboardingSnapshot,
} from "@/lib/onboarding";
import { formatCurrency, formatUserError } from "@/lib/utils";

type PublicOnboardingPageProps = {
  audience: PublicOnboardingAudience;
  publicSlug: string;
  initialData: PublicOnboardingSnapshot;
};

const boardStatuses: InitiativeStatus[] = ["backlog", "planned", "executing", "completed"];
const summaryStatuses: InitiativeStatus[] = ["executing", "planned", "backlog", "completed"];
type PublicDraftTargetStatus = Extract<InitiativeStatus, "backlog" | "planned">;

function getStatusDot(status: InitiativeStatus) {
  if (status === "executing") return "bg-emerald-500";
  if (status === "planned") return "bg-indigo-500";
  if (status === "completed") return "bg-slate-700";
  return "bg-slate-300";
}

function getSafeStatusMeta(status: InitiativeStatus | string | null | undefined) {
  return STATUS_META[
    status === "planned" || status === "executing" || status === "completed" ? status : "backlog"
  ];
}

function normalizeCatalogText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
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

function minCalendarDate(values: Date[]) {
  return values.reduce((earliest, current) => (current < earliest ? current : earliest));
}

function maxCalendarDate(values: Date[]) {
  return values.reduce((latest, current) => (current > latest ? current : latest));
}

function getPublicTimelineBarClass(status: InitiativeStatus) {
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

function getPublicBoardAccentClass(status: InitiativeStatus) {
  if (status === "executing") return "bg-[#00bda5]";
  if (status === "planned") return "bg-[#6a78d1]";
  if (status === "completed") return "bg-[#33475b]";
  return "bg-[#cbd6e2]";
}

function formatLongDate(value: string) {
  return new Intl.DateTimeFormat("es-NI", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function getDaysUntil(date: string | null) {
  if (!date) return null;

  return Math.max(
    0,
    Math.ceil(
      (new Date(`${date}T00:00:00`).getTime() - new Date().setHours(0, 0, 0, 0)) /
        (1000 * 60 * 60 * 24),
    ),
  );
}

function getPublicInitiativeSpanLabel(
  startDate: string | null,
  endDate: string | null,
  fallbackCount = 0,
) {
  if (startDate && endDate) {
    const days = Math.max(
      diffCalendarDays(parseCalendarDate(startDate), parseCalendarDate(endDate)) + 1,
      1,
    );
    return `${days}d`;
  }

  return fallbackCount > 0 ? `${fallbackCount} act` : "--";
}

function getPublicDraftStatusLabel(status: PublicDraftTargetStatus) {
  return status === "planned" ? "Planificado" : "En evaluacion";
}

export function PublicOnboardingPage({
  audience,
  publicSlug,
  initialData,
}: PublicOnboardingPageProps) {
  const [config, setConfig] = useState(initialData.config);
  const [initiatives, setInitiatives] = useState(initialData.initiatives);
  const [billing, setBilling] = useState(initialData.billing);
  const [prospectProposal, setProspectProposal] = useState(initialData.prospectProposal ?? null);
  const [requestDraft, setRequestDraft] = useState({
    title: "",
    description: "",
    selectedCatalogItemIds: [] as string[],
  });
  const [requestTargetStatus, setRequestTargetStatus] = useState<PublicDraftTargetStatus>("backlog");
  const [catalogSelection, setCatalogSelection] = useState("");
  const [isGroupBuilderOpen, setIsGroupBuilderOpen] = useState(false);
  const [isCatalogModalOpen, setIsCatalogModalOpen] = useState(false);
  const [isExtraCreditsModalOpen, setIsExtraCreditsModalOpen] = useState(false);
  const [activeCatalogTab, setActiveCatalogTab] = useState("");
  const [catalogPreviewGroup, setCatalogPreviewGroup] = useState<CatalogModalGroup | null>(null);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [couponCode, setCouponCode] = useState(initialData.prospectProposal?.appliedCouponCode ?? "");
  const [isCouponPanelOpen, setIsCouponPanelOpen] = useState(
    Boolean(initialData.prospectProposal?.appliedCouponCode?.trim()),
  );
  const [isApplyingCoupon, setIsApplyingCoupon] = useState(false);
  const [isStartingPayment, setIsStartingPayment] = useState(false);
  const [isSyncingPayment, setIsSyncingPayment] = useState(false);

  const stage = resolveStageFromPublicAudience(audience);
  const stageMeta = STAGE_META[stage];
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
  const catalogOptions = useMemo(() => {
    const grouped = new Map<string, typeof initialData.catalog>();

    initialData.catalog.forEach((item) => {
      const bucket = grouped.get(item.category) ?? [];
      bucket.push(item);
      grouped.set(item.category, bucket);
    });

    const orderedCategoryNames = initialData.catalogCategories
      .filter((category) => category.is_active)
      .sort(
        (left, right) =>
          left.sort_order - right.sort_order || left.name.localeCompare(right.name, "es"),
      )
      .map((category) => category.name)
      .filter((categoryName) => grouped.has(categoryName));
    const orderedCategorySet = new Set(orderedCategoryNames);
    const remainingCategoryNames = Array.from(grouped.keys()).filter(
      (categoryName) => !orderedCategorySet.has(categoryName),
    );

    return [...orderedCategoryNames, ...remainingCategoryNames.sort((left, right) => left.localeCompare(right, "es"))]
      .map((category) => ({
        category,
        items: [...(grouped.get(category) ?? [])].sort(
          (left, right) =>
            left.sort_order - right.sort_order || left.label.localeCompare(right.label, "es"),
        ),
      }))
      .filter((entry) => entry.items.length > 0);
  }, [initialData]);
  const catalogItemMap = useMemo(
    () => new Map(initialData.catalog.map((item) => [item.id, item])),
    [initialData.catalog],
  );
  const catalogGroups = useMemo(() => {
    return buildCatalogModalGroups({
      groups: initialData.catalogGroups,
      categories: initialData.catalogGroupCategories,
      categoryLinks: initialData.catalogGroupCategoryLinks,
      memberships: initialData.catalogGroupMemberships,
      items: initialData.catalog,
    });
  }, [initialData.catalog, initialData.catalogGroupCategories, initialData.catalogGroupCategoryLinks, initialData.catalogGroupMemberships, initialData.catalogGroups]);
  const catalogGroupOptions = useMemo(() => {
    return buildCatalogGroupOptions(catalogGroups, initialData.catalogGroupCategories);
  }, [catalogGroups, initialData.catalogGroupCategories]);
  const defaultCatalogLibraryTab = catalogGroupOptions[0]?.id ?? "";
  const selectedCatalogItems = useMemo(
    () =>
      requestDraft.selectedCatalogItemIds
        .map((catalogItemId) => catalogItemMap.get(catalogItemId))
        .filter((item): item is NonNullable<typeof item> => Boolean(item)),
    [catalogItemMap, requestDraft.selectedCatalogItemIds],
  );
  const selectedCatalogCredits = useMemo(
    () => selectedCatalogItems.reduce((sum, item) => sum + item.credits, 0),
    [selectedCatalogItems],
  );

  const cycleDaysRemaining = useMemo(() => getDaysUntil(metrics.cutoffDate), [metrics.cutoffDate]);
  const paymentAmount = Number(
    config.custom_plan_price ?? suggestPlanPrice(config.custom_plan_credits ?? config.base_capacity),
  );
  const contractedPlanCredits = Math.max(config.custom_plan_credits ?? config.base_capacity, 0);
  const extraPackageResultingCredits = metrics.total + PUBLIC_EXTRA_CREDIT_PACKAGE.credits;
  const isRecurringPlan = config.custom_plan_billing_mode !== "one_time";
  const paymentAmountLabel = isRecurringPlan
    ? `Inversión ${getPlanCadenceLabel(config.custom_plan_period_months)}`
    : "Inversión total";
  const usesStripeMembership = config.custom_plan_billing_mode !== "one_time";
  const progressParts = useMemo(() => {
    const total = Math.max(metrics.total, 1);

    return {
      consumed: (metrics.consumed / total) * 100,
      reserved: (metrics.reserved / total) * 100,
      lost: (metrics.lost / total) * 100,
      available: (Math.max(metrics.available, 0) / total) * 100,
    };
  }, [metrics.available, metrics.consumed, metrics.lost, metrics.reserved, metrics.total]);
  const hasActivatedWork = initiatives.some(
    (initiative) =>
      initiative.status === "planned" ||
      initiative.status === "executing" ||
      initiative.status === "completed",
  );
  const hasPaidCycleAccess =
    audience === "prospect"
      ? billing.current_cycle_paid || Boolean(billing.paid_at)
      : billing.current_cycle_paid ||
        Boolean(billing.paid_at) ||
        (!usesStripeMembership && billing.active_credits > 0) ||
        hasActivatedWork;
  const shouldShowPaymentCta = paymentAmount > 0 && !hasPaidCycleAccess;
  const shouldPromptPayment = shouldShowPaymentCta;
  const hasAppliedCoupon = Boolean(prospectProposal?.appliedCouponCode.trim());
  const appliedCouponLabel = hasAppliedCoupon
    ? `Cupón aplicado: ${prospectProposal?.appliedCouponCode}`
    : "Canjear cupón";
  const percentageCouponLabel =
    hasAppliedCoupon &&
    prospectProposal?.appliedCouponType === "percentage" &&
    prospectProposal.appliedCouponPercentageOff !== null
      ? `${prospectProposal.appliedCouponPercentageOff}% OFF aplicado`
      : appliedCouponLabel;
  const prospectPlanActionLabel =
    isStartingPayment || isSyncingPayment
      ? "Confirmando pago..."
      : hasPaidCycleAccess
        ? "Plan activo"
        : "Activar Plan";
  const paymentButtonLabel =
    isStartingPayment || isSyncingPayment
      ? "Confirmando pago..."
      : audience === "prospect"
        ? paymentAmount <= 0
          ? "Activar plan sin pago"
          : usesStripeMembership
            ? `Pagar membresia ${getPlanCadenceLabel(config.custom_plan_period_months)} ${formatCurrency(paymentAmount)}`
            : `Pagar propuesta ${formatCurrency(paymentAmount)}`
        : usesStripeMembership
          ? `Activar membresia ${getPlanCadenceLabel(config.custom_plan_period_months)} ${formatCurrency(paymentAmount)}`
          : `Pagar ${formatCurrency(paymentAmount)}`;
  const timeline = useMemo(() => {
    const today = new Date();
    const windowStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const windowEnd = addCalendarDays(addRollingCalendarMonths(windowStart, 3), 1);

    const datedRows = initiatives
      .map((initiative) => {
        const subitemDates = initiative.subitems
          .map((subitem) => subitem.target_date)
          .filter((value): value is string => Boolean(value))
          .map(parseCalendarDate);

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
    const rows = datedRows
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
      rows,
      undatedRows: datedRows.filter((row) => !row.start || !row.end).map((row) => row.initiative),
      windowStart,
      windowEnd,
    };
  }, [initiatives]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paymentStatus = params.get("payment");
    const sessionId = params.get("session_id");

    if (paymentStatus === "cancelled") {
      setFeedback({
        tone: "error",
        message: "El pago fue cancelado. Puedes intentarlo nuevamente cuando quieras.",
      });
      params.delete("payment");
      const cleanUrl = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
      window.history.replaceState({}, "", cleanUrl);
      return;
    }

    if (paymentStatus !== "success" || !sessionId) {
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
        const response = await fetch("/api/stripe/sync-session", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sessionId,
            slug: publicSlug,
          }),
        });

      const payload = (await response.json()) as {
        billing?: ClientBillingStatus;
        purchaseKind?: "plan" | "extra_capacity_package";
        message?: string;
      };

        if (!response.ok || !payload.billing) {
          throw new Error(payload.message || "No pudimos confirmar el pago.");
        }

        if (!isMounted) return;

        setBilling(payload.billing);
        setFeedback({
          tone: "success",
          message:
            payload.purchaseKind === "extra_capacity_package"
              ? `Pago confirmado. Ya habilitamos ${PUBLIC_EXTRA_CREDIT_PACKAGE.credits} créditos extra.`
              : "Pago confirmado. El ciclo quedo activo.",
        });
        params.delete("payment");
        params.delete("session_id");
        const cleanUrl = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
        window.history.replaceState({}, "", cleanUrl);
      } catch (caughtError) {
        if (!isMounted) return;

        setFeedback({
          tone: "error",
          message: formatUserError(
            caughtError,
            "El pago se completo, pero no pudimos actualizar el ciclo automaticamente.",
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
  }, [publicSlug]);

  async function createPublicRequest(
    draft: {
      title: string;
      description: string;
      selectedCatalogItemIds: string[];
      selectedGroupId?: string | null;
    },
    targetStatus: PublicDraftTargetStatus = requestTargetStatus,
  ) {
    setFeedback(null);
    const resolvedTargetStatus: PublicDraftTargetStatus =
      audience === "prospect" ? "backlog" : targetStatus;

    if (!draft.title.trim()) {
      setFeedback({
        tone: "error",
        message: "Escribe un titulo para el caso de uso que quieres proponer.",
      });
      return;
    }

    if (!draft.selectedCatalogItemIds.length && !draft.selectedGroupId?.trim()) {
      setFeedback({
        tone: "error",
        message: "Selecciona al menos una tarea de la biblioteca para armar el caso de uso.",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/public-onboarding/${audience}/${publicSlug}/initiatives`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: draft.title.trim(),
          description: draft.description.trim(),
          catalogItemIds: draft.selectedCatalogItemIds,
          groupId: draft.selectedGroupId?.trim() || undefined,
          targetStatus: resolvedTargetStatus,
        }),
      });

      const payload = (await response.json()) as
        | (InitiativeRecord & { message?: string; selected_catalog_item_ids?: string[] })
        | { message?: string };

      if (!response.ok) {
        throw new Error(
          ("message" in payload && payload.message) ||
            "No fue posible registrar tu solicitud.",
        );
      }

      const nextInitiative = payload as InitiativeRecord & { selected_catalog_item_ids?: string[] };
      const selectedItems = (nextInitiative.selected_catalog_item_ids ?? draft.selectedCatalogItemIds)
        .map((catalogItemId) => catalogItemMap.get(catalogItemId))
        .filter((item): item is NonNullable<typeof item> => Boolean(item));
      const nowIso = new Date().toISOString();
      const returnedSubitems: InitiativeRecord["subitems"] = (nextInitiative.subitems ?? []).map(
        (subitem, index) => ({
          ...subitem,
          id: subitem.id ?? `${nextInitiative.id}-subitem-${index}`,
          initiative_id: subitem.initiative_id ?? nextInitiative.id,
          catalog_item_id: subitem.catalog_item_id ?? null,
          name: subitem.name,
          status:
            subitem.status === "in_progress" ||
            subitem.status === "blocked" ||
            subitem.status === "completed"
              ? subitem.status
              : "pending",
          target_date: subitem.target_date ?? null,
          unit_credits: Number(subitem.unit_credits ?? 0),
          quantity: Number(subitem.quantity ?? 1),
          sort_order: Number(subitem.sort_order ?? index),
          created_at: subitem.created_at ?? nowIso,
          updated_at: subitem.updated_at ?? nowIso,
        }),
      );
      const resolvedSubitems: InitiativeRecord["subitems"] = returnedSubitems.length
        ? returnedSubitems
        : selectedItems.map((item, index) => ({
            id: `${nextInitiative.id}-${item.id}`,
            initiative_id: nextInitiative.id,
            catalog_item_id: item.id,
            name: item.label,
            status: "pending" as const,
            target_date: null,
            unit_credits: item.credits,
            quantity: 1,
            sort_order: index,
            created_at: nowIso,
            updated_at: nowIso,
          }));
      setInitiatives((current) =>
        [...current, {
          ...nextInitiative,
          labels: nextInitiative.labels ?? [],
          logs: nextInitiative.logs ?? [],
          subitems: resolvedSubitems,
          credits: resolvedSubitems.reduce(
            (sum, item) => sum + Number(item.unit_credits ?? 0) * Number(item.quantity ?? 1),
            0,
          ),
          progressPercent: 0,
        }].sort((left, right) => left.sort_order - right.sort_order),
      );
      setRequestDraft({ title: "", description: "", selectedCatalogItemIds: [] });
      setCatalogSelection("");
      setIsGroupBuilderOpen(false);
      setFeedback({
        tone: "success",
        message: `Tu solicitud quedo registrada en ${getPublicDraftStatusLabel(resolvedTargetStatus)}.`,
      });
    } catch (caughtError) {
      setFeedback({
        tone: "error",
        message: formatUserError(
          caughtError,
          "No fue posible registrar tu solicitud en este momento.",
        ),
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitPublicRequest() {
    await createPublicRequest(requestDraft);
  }

  async function startStripeCheckout(purchaseKind: "plan" | "extra_package" = "plan") {
    setFeedback(null);
    setIsStartingPayment(true);

    try {
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          audience,
          slug: publicSlug,
          purchaseKind,
        }),
      });

      const payload = (await response.json()) as {
        url?: string;
        config?: PublicOnboardingSnapshot["config"];
        billing?: ClientBillingStatus;
        prospectProposal?: PublicOnboardingSnapshot["prospectProposal"];
        message?: string;
      };

      if (!response.ok) {
        throw new Error(payload.message || "No pudimos abrir el formulario de pago.");
      }

      if (payload.config && payload.billing) {
        setConfig(payload.config);
        setBilling(payload.billing);
        setProspectProposal(payload.prospectProposal ?? null);
        setCouponCode(payload.prospectProposal?.appliedCouponCode ?? couponCode);
        setIsCouponPanelOpen(Boolean(payload.prospectProposal?.appliedCouponCode?.trim()));
        setIsStartingPayment(false);
        setFeedback({
          tone: "success",
          message: payload.message || "Plan activado correctamente.",
        });
        return;
      }

      if (!payload.url) {
        throw new Error(payload.message || "No pudimos abrir el formulario de pago.");
      }

      window.location.assign(payload.url);
    } catch (caughtError) {
      setFeedback({
        tone: "error",
        message: formatUserError(
          caughtError,
          "No pudimos abrir el formulario de pago.",
        ),
      });
      setIsStartingPayment(false);
    }
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
      const response = await fetch(`/api/public-onboarding/${audience}/${publicSlug}/apply-coupon`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ code: normalizedCode }),
      });

      const payload = (await response.json()) as {
        config?: PublicOnboardingSnapshot["config"];
        billing?: ClientBillingStatus;
        prospectProposal?: PublicOnboardingSnapshot["prospectProposal"];
        message?: string;
      };

      if (!response.ok || !payload.config || !payload.billing) {
        throw new Error(payload.message || "No pudimos aplicar el cupon.");
      }

      setConfig(payload.config);
      setBilling(payload.billing);
      setProspectProposal(payload.prospectProposal ?? null);
      setCouponCode(payload.prospectProposal?.appliedCouponCode ?? normalizedCode);
      setIsCouponPanelOpen(Boolean(payload.prospectProposal?.appliedCouponCode?.trim()));
      setFeedback({
        tone: "success",
        message: payload.message || "Cupon aplicado correctamente.",
      });
    } catch (caughtError) {
      setFeedback({
        tone: "error",
        message: formatUserError(caughtError, "No pudimos aplicar el cupon al prospecto."),
      });
    } finally {
      setIsApplyingCoupon(false);
    }
  }

  function handleRedeemCoupon() {
    setIsCouponPanelOpen((current) => !current);
  }

  function addCatalogItem() {
    if (!catalogSelection) {
      setFeedback({
        tone: "error",
        message: "Selecciona una tarea disponible antes de añadirla al caso de uso.",
      });
      return;
    }

    setFeedback(null);
    setRequestDraft((current) => ({
      ...current,
      selectedCatalogItemIds: current.selectedCatalogItemIds.includes(catalogSelection)
        ? current.selectedCatalogItemIds
        : [...current.selectedCatalogItemIds, catalogSelection],
    }));
    setCatalogSelection("");
  }

  function removeCatalogItem(itemId: string) {
    setRequestDraft((current) => ({
      ...current,
      selectedCatalogItemIds: current.selectedCatalogItemIds.filter((value) => value !== itemId),
    }));
  }

  function closeGroupedBuilder() {
    setIsGroupBuilderOpen(false);
  }

  function openGroupedBuilder(targetStatus: PublicDraftTargetStatus = "backlog") {
    const selectedItem = initialData.catalog.find((item) => item.id === catalogSelection);

    setFeedback(null);
    setRequestTargetStatus(targetStatus);
    setRequestDraft({
      title: selectedItem?.label ?? "",
      description: "",
      selectedCatalogItemIds: selectedItem ? [selectedItem.id] : [],
    });
    setCatalogSelection("");
    setIsGroupBuilderOpen(true);
  }

  async function quickAddCatalogItemRequest(targetStatus: PublicDraftTargetStatus = "backlog") {
    const selectedItem = initialData.catalog.find((item) => item.id === catalogSelection);

    if (!selectedItem) {
      setFeedback({
        tone: "error",
        message: "Selecciona una tarea antes de añadirla.",
      });
      return;
    }

    await createPublicRequest(
      {
        title: selectedItem.label,
        description: "",
        selectedCatalogItemIds: [selectedItem.id],
      },
      targetStatus,
    );
  }

  function openCatalogModal(targetStatus: PublicDraftTargetStatus = "backlog") {
    setFeedback(null);
    setRequestTargetStatus(targetStatus);
    setActiveCatalogTab(defaultCatalogLibraryTab);
    setCatalogPreviewGroup(null);
    setIsCatalogModalOpen(true);
  }

  function closeCatalogModal() {
    setIsCatalogModalOpen(false);
    setCatalogPreviewGroup(null);
  }

  function openCatalogGroupPreview(group: CatalogModalGroup) {
    setCatalogPreviewGroup(group);
  }

  function closeCatalogGroupPreview() {
    setCatalogPreviewGroup(null);
  }

  function loadGroupIntoBuilder(group: CatalogModalGroup) {
    setFeedback(null);
    setRequestDraft({
      title: group.name,
      description: group.description,
      selectedCatalogItemIds: group.items.map((item) => item.id),
    });
    setCatalogSelection("");
    setCatalogPreviewGroup(null);
    setIsCatalogModalOpen(false);
    setIsGroupBuilderOpen(true);
  }

  async function quickAddCatalogGroup(group: CatalogModalGroup) {
    await createPublicRequest({
      title: group.name,
      description: group.description,
      selectedCatalogItemIds: group.items.map((item) => item.id),
      selectedGroupId: group.id,
    }, requestTargetStatus);
    setCatalogPreviewGroup(null);
    setIsCatalogModalOpen(false);
  }

  return (
    <div className="min-h-screen bg-[#f5f8fa] text-[#33475b]">
      <header className="border-b border-[#dfe3eb] bg-white">
        <div className="flex flex-col gap-3 px-5 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-4">
            <BrandLogo href="/" priority />
            {audience !== "prospect" ? (
              <>
                <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#516f90]">
                  Vista publica
                </span>
                <span className="rounded-[3px] border border-[#cbd6e2] bg-[#f5f8fa] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[#516f90]">
                  Cliente
                </span>
              </>
            ) : null}
          </div>

        </div>
      </header>

      <main className="space-y-5 px-5 py-5">
        {shouldPromptPayment && audience !== "prospect" ? (
          <section className="rounded-[16px] border border-[#fed7aa] bg-[#fff7ed] px-4 py-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#c2410c]">
                  Ciclo pendiente de pago
                </p>
                {initialData.paymentEmail ? (
                  <p className="mt-1 text-sm text-[#7c5a3c]">
                    Referencia: <strong>{initialData.paymentEmail}</strong>
                  </p>
                ) : null}
              </div>
              <Button
                onClick={() => void startStripeCheckout("plan")}
                disabled={isStartingPayment || isSyncingPayment || paymentAmount <= 0}
                className="rounded-[10px] bg-[#ea580c] px-5 text-white hover:bg-[#c2410c]"
              >
                <CreditCard className="mr-2 h-4 w-4" />
                {paymentButtonLabel}
              </Button>
            </div>
          </section>
        ) : null}

        <section className="overflow-hidden rounded-[20px] border border-[#dfe3eb] bg-white">
          <div className="border-b border-[#dfe3eb] px-5 py-4">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-[24px] font-semibold tracking-[-0.03em] text-[#33475b]">
                    {initialData.client.name}
                  </h1>
                  <div className="flex items-center gap-2 text-[11px] text-[#516f90]">
                    <CalendarDays className="h-3.5 w-3.5" />
                    <span>{formatLongDate(config.start_date)}</span>
                  </div>
                  <Badge className="bg-[#e6fffb] text-[#00a88f]">
                    {isRecurringPlan ? "Recurrente" : "Paquete de créditos"}
                  </Badge>
                  {isRecurringPlan ? (
                    <Badge className="bg-[#f5f8fa] text-[#516f90]">
                      {cycleDaysRemaining ?? 0} d restantes del ciclo
                    </Badge>
                  ) : null}
                  {audience !== "prospect" ? (
                    <Badge className="bg-[#e6fffb] text-[#00a88f]">Vista {stageMeta.shortLabel}</Badge>
                  ) : null}
                </div>
                <p className="mt-4 max-w-4xl text-sm text-[#516f90]">
                  {initialData.client.description || stageMeta.description}
                </p>
              </div>

              <div
                className={`flex w-full flex-col gap-3 ${
                  audience === "prospect" || audience === "client" ? "max-w-[520px]" : "max-w-[360px]"
                }`}
              >
                {audience === "prospect" ? (
                  <div className="w-full rounded-[6px] border border-[#cbd6e2] bg-white shadow-sm transition hover:shadow-md">
                    <div className="flex flex-wrap items-stretch">
                      <div className="flex min-w-[148px] flex-1 flex-col justify-center px-4 py-3">
                        <p className="text-[8px] font-bold uppercase tracking-[0.16em] text-[#9cb1c6]">
                          {paymentAmountLabel}
                        </p>
                        <p className="mt-1 whitespace-nowrap text-[22px] font-extrabold leading-none text-[#33475b] [font-variant-numeric:tabular-nums]">
                          {formatCurrency(paymentAmount)}
                        </p>
                      </div>
                      <div className="my-2 hidden w-px bg-[#dfe3eb] sm:block" />
                      <div className="flex shrink-0 items-center px-4 py-3">
                        <span className="inline-flex h-11 min-w-[96px] items-center justify-center whitespace-nowrap rounded-[2px] border border-[#9fe7dc] bg-[#ecfffb] px-4 text-[16px] font-bold text-[#00bda5] [font-variant-numeric:tabular-nums]">
                          {contractedPlanCredits} CR
                        </span>
                      </div>
                      <div className="my-2 hidden w-px bg-[#dfe3eb] sm:block" />
                      <div className="flex min-w-[220px] flex-1 items-center px-3 py-3">
                        <button
                          type="button"
                          onClick={() => void startStripeCheckout("plan")}
                          disabled={hasPaidCycleAccess || isStartingPayment || isSyncingPayment}
                          className="inline-flex h-11 w-full items-center justify-center gap-2 whitespace-nowrap rounded-[4px] bg-[#ff7a59] px-5 text-[14px] font-bold text-white transition hover:bg-[#dc6548] disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          <span className="whitespace-nowrap">{prospectPlanActionLabel}</span>
                          <Sparkles className="h-3.5 w-3.5 shrink-0" />
                        </button>
                      </div>
                    </div>

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
                ) : null}
                <div className="rounded-[14px] border border-[#dfe3eb] bg-[#f8fbfd] px-4 py-3 text-[13px] text-[#516f90]">
                  {audience === "client"
                    ? "Puedes proponer nuevas iniciativas solo en En evaluacion."
                    : "Puedes proponer nuevas iniciativas, pero solo entraran en En evaluacion."}
                </div>
                {audience === "client" ? (
                  <div className="w-full rounded-[6px] border border-[#cbd6e2] bg-white shadow-sm transition hover:shadow-md">
                    <div className="border-b border-[#dfe3eb] px-4 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#00a88f]">
                        Ampliar plan
                      </p>
                    </div>
                    <div className="flex flex-wrap items-stretch">
                      <div className="flex min-w-[148px] flex-1 flex-col justify-center px-4 py-3">
                        <p className="text-[8px] font-bold uppercase tracking-[0.16em] text-[#9cb1c6]">
                          Inversión total
                        </p>
                        <p className="mt-1 whitespace-nowrap text-[22px] font-extrabold leading-none text-[#33475b] [font-variant-numeric:tabular-nums]">
                          {formatCurrency(PUBLIC_EXTRA_CREDIT_PACKAGE.price)}
                        </p>
                      </div>
                      <div className="my-2 hidden w-px bg-[#dfe3eb] sm:block" />
                      <div className="flex shrink-0 items-center px-4 py-3">
                        <span className="inline-flex h-11 min-w-[96px] items-center justify-center whitespace-nowrap rounded-[2px] border border-[#9fe7dc] bg-[#ecfffb] px-4 text-[16px] font-bold text-[#00bda5] [font-variant-numeric:tabular-nums]">
                          {PUBLIC_EXTRA_CREDIT_PACKAGE.credits} CR
                        </span>
                      </div>
                      <div className="my-2 hidden w-px bg-[#dfe3eb] sm:block" />
                      <div className="flex shrink-0 items-center px-2 py-3">
                        <button
                          type="button"
                          onClick={() => setIsExtraCreditsModalOpen(true)}
                          disabled={isStartingPayment || isSyncingPayment}
                          className="grid h-11 w-11 shrink-0 place-items-center rounded-[4px] border border-[#cbd6e2] bg-[#f5f8fa] text-[#516f90] transition hover:border-[#ff7a59] hover:bg-[#ff7a59] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                          aria-label="Abrir detalle del paquete adicional"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="my-2 hidden w-px bg-[#dfe3eb] sm:block" />
                      <div className="flex min-w-[220px] flex-1 items-center px-3 py-3">
                        <button
                          type="button"
                          onClick={() => void startStripeCheckout("extra_package")}
                          disabled={isStartingPayment || isSyncingPayment}
                          className="inline-flex h-11 w-full items-center justify-center gap-2 whitespace-nowrap rounded-[4px] bg-[#ff7a59] px-5 text-[14px] font-bold text-white transition hover:bg-[#dc6548] disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          <span className="whitespace-nowrap">
                            {isStartingPayment || isSyncingPayment ? "Confirmando pago..." : "Pagar"}
                          </span>
                          <CreditCard className="h-3.5 w-3.5 shrink-0" />
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#8aa0b4]">
              <div>
                Disponibles <span className="ml-1 text-[22px] normal-case text-[#00bda5]">{metrics.available} créditos</span>
              </div>
              <div>
                Comprometidos <span className="ml-1 text-[22px] normal-case text-[#5c6ac4]">{metrics.reserved} créditos</span>
              </div>
              <div>
                Completados <span className="ml-1 text-[22px] normal-case text-[#33475b]">{metrics.consumed} créditos</span>
              </div>
              <div>
                Deducidos <span className="ml-1 text-[22px] normal-case text-[#94a3b8]">{metrics.lost} créditos</span>
              </div>
            </div>

            <div className="mt-4 h-[4px] w-full overflow-hidden rounded-full bg-[#dfe3eb]">
              <div className="flex h-full w-full">
                <div style={{ width: `${progressParts.available}%` }} className="bg-[#00bda5]" />
                <div style={{ width: `${progressParts.reserved}%` }} className="bg-[#5c6ac4]" />
                <div style={{ width: `${progressParts.consumed}%` }} className="bg-[#33475b]" />
                <div style={{ width: `${progressParts.lost}%` }} className="bg-[#94a3b8]" />
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[20px] border border-[#dfe3eb] bg-[#f0f4f8] p-3">
          <div className="grid gap-4 xl:grid-cols-4">
            {boardStatuses.map((status) => {
              const items = groupedInitiatives[status];
              const totalCredits = items.reduce((sum, initiative) => sum + initiative.credits, 0);
              const allowsCustomBuilder =
                (audience === "client" || audience === "prospect") &&
                catalogOptions.length > 0 &&
                status === "backlog";
              const allowsCatalogAdd =
                (audience === "client" || audience === "prospect") &&
                catalogGroupOptions.length > 0 &&
                status === "backlog";

              return (
                <div key={status} className="flex min-h-[270px] flex-col">
                  <div className="mb-2 flex items-center justify-between px-1">
                    <div className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${getStatusDot(status)}`} />
                      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#516f90]">
                        {getSafeStatusMeta(status).label}
                      </p>
                    </div>
                    <span className="rounded-[3px] bg-white px-2 py-1 text-[10px] font-bold text-[#516f90]">
                      {totalCredits} CR
                    </span>
                  </div>

                  <div className="min-h-[220px] flex-1 space-y-3 rounded-[4px] border border-dashed border-transparent bg-transparent p-2">
                    {items.map((initiative) => {
                      const estimatedStatus = getEstimatedStatus(
                        initiative.est_start_date,
                        initiative.est_end_date,
                        initiative.status,
                      );
                      const spanLabel = getPublicInitiativeSpanLabel(
                        initiative.est_start_date,
                        initiative.est_end_date,
                        initiative.subitems.length,
                      );
                      const inactiveDays =
                        initiative.status === "executing"
                          ? Math.ceil(
                              (new Date().getTime() -
                                new Date(
                                  `${initiative.last_activity ?? new Date().toISOString().slice(0, 10)}T00:00:00`,
                                ).getTime()) /
                                (1000 * 60 * 60 * 24),
                            )
                          : 0;
                      const progressPercent = Math.max(0, Math.min(100, initiative.progressPercent ?? 0));

                      return (
                        <div
                          key={initiative.id}
                          className="relative w-full rounded-[4px] border border-[#dfe3eb] bg-white px-4 py-3 text-left shadow-sm"
                        >
                          <div
                            className={`absolute left-0 top-0 h-full w-[3px] ${getPublicBoardAccentClass(status)}`}
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
                                  <h3 className="text-[13px] font-bold leading-4 text-[#33475b]">
                                    {initiative.title}
                                  </h3>
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
                                {estimatedStatus && estimatedStatus.label !== "Sin fechas"
                                  ? ` - ${estimatedStatus.label}`
                                  : ""}
                              </div>

                              {initiative.is_blocked ? (
                                <div className="text-[9px] font-bold uppercase tracking-[0.08em] text-[#ef4444]">
                                  Bloqueada
                                </div>
                              ) : initiative.status === "executing" && inactiveDays > 7 ? (
                                <div className="text-[9px] font-bold text-[#ef4444]">
                                  Inactiva {inactiveDays} d
                                </div>
                              ) : null}
                            </div>

                            <div className="mt-3 flex items-center justify-between border-t border-[#eaf0f6] pt-2">
                              <span className="text-[10px] font-bold text-[#9cb1c6]">
                                {spanLabel}
                              </span>
                              <span className="rounded-[2px] bg-[#eaf0f6] px-1.5 py-0.5 text-[10px] font-bold text-[#33475b]">
                                {initiative.credits} CR
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {!items.length ? (
                      <div className="rounded-[4px] border border-dashed border-[#cbd6e2] bg-white/70 p-4 text-[11px] text-[#9cb1c6]">
                        Vacio
                      </div>
                    ) : null}

                    {allowsCustomBuilder || allowsCatalogAdd ? (
                      <div className="mt-3 space-y-2">
                        {allowsCustomBuilder ? (
                          <div className="rounded-[4px] border border-dashed border-[#cbd6e2] bg-white p-1.5 shadow-sm">
                            <select
                              value={catalogSelection}
                              onChange={(event) => setCatalogSelection(event.target.value)}
                              className="h-10 w-full appearance-none rounded-[12px] border border-[#e5e7eb] bg-white px-4 text-[10px] font-medium leading-4 text-[#33475b] outline-none"
                            >
                              <option value="">-- Rápido --</option>
                              {catalogOptions.map((entry) => (
                                <optgroup key={entry.category} label={entry.category}>
                                  {entry.items.map((item) => (
                                    <option key={item.id} value={item.id}>
                                      {item.label} ({item.credits} CR)
                                    </option>
                                  ))}
                                </optgroup>
                              ))}
                            </select>
                            <div className="mt-1.5 flex gap-1.5">
                              <Button
                                variant="secondary"
                                className="h-7 flex-1 rounded-[999px] border-[#e5e7eb] bg-white px-2 py-1 text-[10px] font-bold text-[#7b8794]"
                                onClick={() => void quickAddCatalogItemRequest("backlog")}
                                disabled={isSubmitting || !catalogSelection}
                              >
                                Añadir
                              </Button>
                              <Button
                                variant="secondary"
                                className="h-7 rounded-[999px] border-[#e5e7eb] bg-white px-4 py-1 text-[10px] font-bold text-[#33475b]"
                                onClick={() => openGroupedBuilder("backlog")}
                              >
                                Agrupar
                              </Button>
                            </div>
                          </div>
                        ) : null}
                        {allowsCatalogAdd ? (
                          <Button
                            variant="primary"
                            className="w-full !rounded-[4px] !border-2 !border-dashed !border-[#00bda5] !bg-[#effdfa] px-3 py-5 !text-[11px] !font-bold !text-[#00bda5] !shadow-none transition hover:!border-[#00a894] hover:!bg-[#e6fcf8] hover:!text-[#00a894]"
                            onClick={() => openCatalogModal("backlog")}
                          >
                            <Plus className="mr-1.5 h-3.5 w-3.5" />
                            Agregar Caso de Uso
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="bg-white px-6 py-10">
          <div className="mx-auto max-w-[1400px]">
            <div className="mb-8 border-b border-[#dfe3eb] pb-4">
              <h2 className="flex items-center gap-2 text-[20px] font-bold tracking-tight text-[#33475b]">
                <CalendarDays className="h-5 w-5 text-[#00bda5]" />
                Plan de Trabajo
              </h2>
              <p className="mt-2 text-[13px] text-[#516f90]">
                Proyeccion estrategica inicial. El cronograma definitivo se alineara con las prioridades exactas de tu equipo durante la sesion de Kickoff.
              </p>
            </div>

            <div className="mt-6 overflow-x-auto pb-2">
              <div className="min-w-[1160px] overflow-hidden rounded-[6px] border border-[#dfe3eb] bg-white shadow-sm">
                <div
                  className="grid min-w-[1120px]"
                  style={{
                    gridTemplateColumns: `0px minmax(${timeline.timelineDays * timeline.dayWidth}px, 1fr)`,
                  }}
                >
                  <div className="overflow-hidden border-r-0 bg-white" />
                  <div className="overflow-hidden border-b border-[#dfe3eb] bg-[#f5f8fa]">
                    <div className="grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
                      {timeline.monthSegments.map((segment) => (
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
                      style={{ gridTemplateColumns: `repeat(${timeline.timelineDays}, ${timeline.dayWidth}px)` }}
                    >
                      {timeline.dayMarkers.map((marker) => (
                        <div
                          key={marker.key}
                          className="grid h-[24px] place-items-center border-r border-[#eef2f7] text-[8px] font-medium text-[#8aa0b4] last:border-r-0"
                        >
                          {marker.label}
                        </div>
                      ))}
                    </div>
                  </div>

                  {timeline.rows.length ? (
                    timeline.rows.map((row) => (
                      <Fragment key={row.initiative.id}>
                        <div className="h-[30px] w-0 overflow-hidden border-b border-transparent" />
                        <div className="relative border border-[#eaf0f6] border-l-0 border-t-0 bg-white">
                          <div
                            className="grid"
                            style={{
                              gridTemplateColumns: `repeat(${timeline.timelineDays}, ${timeline.dayWidth}px)`,
                            }}
                          >
                            {timeline.dayMarkers.map((marker) => (
                              <div
                                key={`${row.initiative.id}-${marker.key}`}
                                className="h-[30px] border-r border-b border-[#eef2f7] last:border-r-0"
                              />
                            ))}
                          </div>
                          {!row.isOutsideRange ? (
                            <div
                              className={`absolute top-[4px] h-[22px] rounded-[3px] ${getPublicTimelineBarClass(
                                row.initiative.status,
                              )}`}
                              style={{
                                left: `${row.startOffset * timeline.dayWidth}px`,
                                width: `${Math.max(row.span * timeline.dayWidth - 4, timeline.dayWidth * 6)}px`,
                              }}
                              title={`${row.initiative.title} · ${formatDateRange(
                                row.initiative.est_start_date,
                                row.initiative.est_end_date,
                              )}`}
                            >
                              <div className="absolute inset-y-0 left-3 right-3 flex items-center justify-center rounded-[3px] px-1 text-center">
                                <span className="truncate text-[8px] font-semibold leading-none">
                                  {row.initiative.title}
                                </span>
                              </div>
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
                    ))
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

              {timeline.undatedRows.length ? (
                <div className="mt-6 rounded-[6px] border border-dashed border-[#cbd6e2] bg-[#f8fbfd] px-4 py-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#516f90]">
                      Iniciativas sin rango
                    </h3>
                    <span className="rounded-full bg-[#f5f8fa] px-3 py-1 text-[10px] font-bold text-[#516f90]">
                      {timeline.undatedRows.length} pendientes
                    </span>
                  </div>
                  <p className="mt-2 text-[12px] text-[#8aa0b4]">
                    Aun no entran al calendario porque les falta fecha de inicio o fin.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    {timeline.undatedRows.map((initiative) => (
                      <span
                        key={`undated-${initiative.id}`}
                        className="rounded-full border border-[#d7e0ea] bg-white px-4 py-2 text-[11px] text-[#33475b] shadow-[0_1px_2px_rgba(51,71,91,0.05)]"
                      >
                        <span className="font-bold">{initiative.title}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="bg-white px-6 pb-10">
          <div className="mx-auto max-w-[1400px]">
            <div className="border-b border-[#dfe3eb] pb-4">
              <h2 className="text-[14px] font-bold text-[#33475b]">Desglose Analitico por Etapa</h2>
            </div>
            <div className="mt-7 space-y-4">
              {summaryStatuses.map((status) => {
                const items = groupedInitiatives[status];
                if (!items.length) return null;

                return (
                  <div
                    key={`summary-${status}`}
                    className="overflow-hidden rounded-[6px] border border-[#dfe3eb] bg-white shadow-sm"
                  >
                    <div className="flex items-center justify-between border-b border-[#dfe3eb] bg-white px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`h-2.5 w-2.5 rounded-full ${getStatusDot(status)}`} />
                        <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-[#33475b]">
                          {getSafeStatusMeta(status).label}
                        </p>
                      </div>
                      <span className="rounded-[3px] border border-[#cbd6e2] bg-white px-2 py-1 text-[10px] font-bold text-[#33475b]">
                        {items.reduce((sum, initiative) => sum + initiative.credits, 0)} CR
                      </span>
                    </div>
                    <div className="divide-y divide-[#eef2f7]">
                      {items.map((initiative) => (
                        <div
                          key={`summary-card-${initiative.id}`}
                          className="grid gap-6 px-5 py-5 lg:grid-cols-[1.35fr_0.65fr]"
                        >
                          <div>
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <h4 className="text-[14px] font-bold text-[#33475b]">{initiative.title}</h4>
                                <p className="mt-2 text-[11px] leading-5 text-[#516f90]">
                                  {initiative.description || "Sin descripcion ejecutiva."}
                                </p>
                                <div className="mt-2 inline-flex rounded-[3px] border border-[#cbd6e2] bg-[#f5f8fa] px-2 py-0.5 text-[9px] font-bold text-[#33475b]">
                                  {formatDateRange(initiative.est_start_date, initiative.est_end_date)}
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className="rounded-[4px] border border-[#dfe3eb] bg-white p-3">
                            <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#516f90]">
                              Historial de notas
                            </p>
                            <div className="mt-2 border-t border-[#dfe3eb] pt-3">
                              <p className="text-[11px] italic text-[#516f90]">
                                {initiative.logs[0]?.entry || "Sin notas registradas."}
                              </p>
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
        </section>

        <section className="rounded-[18px] border border-[#dfe3eb] bg-white p-4">
          <div className="flex items-start gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-[14px] bg-[#eef6ff] text-[#3b82f6]">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[#33475b]">Acceso restringido</h2>
              <p className="mt-2 text-sm text-[#516f90]">
                Esta vista publica no permite editar etapas, mover tareas, cambiar creditos ni
                modificar configuraciones internas del onboarding.
              </p>
            </div>
          </div>
        </section>
      </main>

      {isCatalogModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#33475b]/70 p-4 backdrop-blur-sm">
          <div className="relative flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[16px] border border-[#dfe3eb] bg-white shadow-2xl">
            <div className="border-b border-[#dfe3eb] bg-white px-6 py-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#9cb1c6]">
                    Catalogo de grupos
                  </p>
                  <h3 className="mt-2 text-[24px] font-extrabold tracking-[-0.02em] text-[#33475b]">
                    Agrega casos de uso completos
                  </h3>
                  <p className="mt-2 text-[13px] text-[#516f90]">
                    Usa el mismo catalogo de grupos para proponer iniciativas completas con sus tareas incluidas.
                  </p>
                </div>
                <Button variant="secondary" onClick={closeCatalogModal}>
                  Cerrar
                </Button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
              <aside className="border-b border-[#dfe3eb] bg-[#f8fbfd] p-4 lg:w-[240px] lg:border-b-0 lg:border-r">
                <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-[#516f90]">
                  Categorias
                </p>
                <div className="space-y-2">
                  {catalogGroupOptions.map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => setActiveCatalogTab(category.id)}
                      className={`w-full rounded-[6px] px-3 py-2 text-left text-[12px] font-bold transition ${
                        activeCatalogTab === category.id
                          ? "bg-[#00bda5] text-white"
                          : "bg-white text-[#33475b] hover:bg-[#eef6ff]"
                      }`}
                    >
                      {category.label}
                    </button>
                  ))}
                </div>
              </aside>

              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                {(catalogGroupOptions.find((category) => category.id === activeCatalogTab)?.groups ?? []).length ? (
                  <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
                    {(catalogGroupOptions.find((category) => category.id === activeCatalogTab)?.groups ?? []).map((group) => (
                      <div
                        key={group.id}
                        className={`flex flex-col rounded-[6px] border p-5 text-left shadow-sm transition ${
                          initiatives.some(
                            (initiative) =>
                              normalizeCatalogText(initiative.title) === normalizeCatalogText(group.name),
                          )
                            ? "border-[#eaf0f6] bg-[#f8fafc]"
                            : "border-[#dfe3eb] bg-white hover:-translate-y-[1px] hover:shadow-md"
                        }`}
                      >
                        <div className="mb-3 flex flex-wrap gap-1.5">
                          <span className="rounded-[2px] border border-[#00bda5]/20 bg-[#f0fdfa] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-[#00bda5]">
                            {group.modalCategory}
                          </span>
                          <span className="rounded-[2px] bg-[#f5f8fa] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-[#516f90]">
                            {group.items.length ? `${group.items.length} tareas` : "Grupo manual"}
                          </span>
                        </div>
                        <h4 className="text-[14px] font-bold leading-snug text-[#33475b]">{group.name}</h4>
                        <p className="mt-2 text-[11px] leading-relaxed text-[#516f90]">
                          {group.description || "Grupo sugerido desde el catalogo para sumarlo al board del cliente."}
                        </p>
                        <div className="mt-auto flex items-center justify-between border-t border-[#eaf0f6] pt-4">
                          <span className="text-[14px] font-bold text-[#ff7a59]">{group.credits} CR</span>
                          <button
                            type="button"
                            onClick={() => openCatalogGroupPreview(group)}
                            className="rounded-[3px] border border-[#99f6e4] bg-[#f0fdfa] px-2.5 py-1 text-[10px] font-bold text-[#00bda5] transition hover:bg-[#ecfffb]"
                          >
                            Ver detalles
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-[10px] border border-dashed border-[#cbd6e2] bg-[#fcfcfc] p-6 text-center text-[12px] text-[#8aa0b4]">
                    No hay grupos activos en esta categoria todavia.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {catalogPreviewGroup ? (
        <div className="fixed inset-0 z-[60] flex justify-end">
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
                  Alcance y descripcion detallada
                </p>
                <div className="mt-3 rounded-[6px] border border-[#dfe3eb] bg-white p-5 shadow-sm">
                  <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[#33475b]">
                    {catalogPreviewGroup.description || "Este grupo no tiene descripcion detallada todavia."}
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
                  onClick={() => loadGroupIntoBuilder(catalogPreviewGroup)}
                  className="flex w-full flex-col items-center justify-center rounded-[6px] bg-[#14b8a6] px-5 py-4 text-white shadow-md transition hover:bg-[#0ea899]"
                >
                  <span className="text-[14px] font-extrabold">Editar antes de enviar</span>
                  <span className="mt-1 text-[11px] font-medium opacity-90">
                    Carga el caso completo en {getPublicDraftStatusLabel(requestTargetStatus).toLowerCase()}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void quickAddCatalogGroup(catalogPreviewGroup)}
                  disabled={isSubmitting}
                  className="flex w-full flex-col items-center justify-center rounded-[6px] bg-[#14b8a6] px-5 py-4 text-white shadow-md transition hover:bg-[#0ea899] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="text-[14px] font-extrabold">
                    {`Crear en ${getPublicDraftStatusLabel(requestTargetStatus).toLowerCase()}`}
                  </span>
                  <span className="mt-1 text-[11px] font-medium opacity-90">
                    Envia el grupo con todas sus tareas
                  </span>
                </button>
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      {isGroupBuilderOpen ? (
        <div className="fixed inset-0 z-50 bg-[#33475b]/60 backdrop-blur-[2px]">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Cerrar panel de agrupación"
            onClick={closeGroupedBuilder}
          />
          <aside className="absolute inset-y-0 right-0 flex w-full max-w-[620px] flex-col border-l border-[#dfe3eb] bg-white shadow-[-16px_0_40px_rgba(51,71,91,0.12)]">
            <div className="border-b border-[#dfe3eb] bg-[#f5f8fa] px-6 pb-5 pt-6">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <span className="inline-flex rounded-[2px] bg-[#eaf0f6] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#516f90]">
                    {getPublicDraftStatusLabel(requestTargetStatus)}
                  </span>
                  <Input
                    value={requestDraft.title}
                    onChange={(event) =>
                      setRequestDraft((current) => ({
                        ...current,
                        title: event.target.value,
                      }))
                    }
                    placeholder="Título del caso de uso"
                    className="mt-4 h-12 border-0 bg-transparent px-0 text-[22px] font-black leading-[1.1] text-[#33475b] shadow-none outline-none"
                  />
                  <Textarea
                    rows={3}
                    value={requestDraft.description}
                    onChange={(event) =>
                      setRequestDraft((current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                    placeholder="Describe brevemente el resultado esperado."
                    className="mt-3 min-h-[88px] border border-[#dfe3eb] bg-white text-[13px] leading-6 text-[#516f90]"
                  />
                </div>
                <Button variant="secondary" onClick={closeGroupedBuilder}>
                  Cerrar
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6">
              <section className="rounded-[6px] border border-[#dfe3eb] bg-[#fcfcfc] p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#516f90]">
                    Tareas disponibles
                  </p>
                  <p className="text-[10px] font-bold text-[#8aa0b4]">
                    {initialData.catalog.length} en biblioteca
                  </p>
                </div>
                <div className="mt-3 flex gap-2">
                  <select
                    value={catalogSelection}
                    onChange={(event) => setCatalogSelection(event.target.value)}
                    className="h-10 w-full appearance-none rounded-[6px] border border-[#cbd6e2] bg-white px-3 text-[11px] text-[#33475b] outline-none"
                  >
                    <option value="">-- Añadir tarea del catálogo --</option>
                    {catalogOptions.map((entry) => (
                      <optgroup key={entry.category} label={entry.category}>
                        {entry.items.map((item) => (
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
                    className="shrink-0 rounded-[6px] border border-[#cbd6e2] bg-white px-3 text-[10px] font-bold text-[#33475b] transition hover:bg-[#f5f8fa]"
                  >
                    Añadir
                  </button>
                </div>
              </section>

              <section className="mt-5">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#9cb1c6]">
                  Tareas incluidas
                </p>
                <div className="mt-3 rounded-[6px] border border-[#dfe3eb] bg-[#fcfcfc] p-4">
                  {selectedCatalogItems.length ? (
                    <ul className="space-y-2">
                      {selectedCatalogItems.map((item) => (
                        <li
                          key={`selected-${item.id}`}
                          className="rounded-[4px] border border-[#eaf0f6] bg-white px-3 py-2"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-[12px] font-bold leading-snug text-[#33475b]">
                                {item.label}
                              </p>
                              <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.12em] text-[#516f90]">
                                {item.category}
                              </p>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="shrink-0 text-[11px] font-bold text-[#ff7a59]">
                                {item.credits} CR
                              </span>
                              <button
                                type="button"
                                onClick={() => removeCatalogItem(item.id)}
                                className="text-[10px] font-bold text-[#ef4444] transition hover:text-[#dc2626]"
                              >
                                Quitar
                              </button>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[12px] text-[#516f90]">
                      Este grupo aún no tiene tareas. Añade actividades desde la biblioteca para armarlo.
                    </p>
                  )}
                </div>
              </section>

              <section className="mt-5 rounded-[6px] border border-[#99f6e4] bg-[#f0fdfa] px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[12px] font-bold uppercase tracking-[0.08em] text-[#00bda5]">
                    Consumo de créditos:
                  </p>
                  <p className="text-[28px] font-extrabold text-[#00bda5]">
                    {selectedCatalogCredits} CR
                  </p>
                </div>
              </section>
            </div>

            <div className="border-t border-[#dfe3eb] bg-white px-6 py-5">
              <Button className="w-full" onClick={submitPublicRequest} disabled={isSubmitting}>
                {isSubmitting
                  ? "Enviando..."
                  : `Crear en ${getPublicDraftStatusLabel(requestTargetStatus).toLowerCase()}`}
              </Button>
            </div>
          </aside>
        </div>
      ) : null}

      {isExtraCreditsModalOpen && audience === "client" ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#33475b]/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-[560px] rounded-[6px] border border-[#dfe3eb] bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#00a88f]">
                  Ampliar plan
                </p>
                <h3 className="mt-2 text-[22px] font-extrabold tracking-[-0.02em] text-[#33475b]">
                  Agregar más créditos
                </h3>
                <p className="mt-2 text-[13px] text-[#516f90]">
                  Este paquete añade {PUBLIC_EXTRA_CREDIT_PACKAGE.credits} créditos a tu capacidad actual.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsExtraCreditsModalOpen(false)}
                className="rounded-[4px] p-2 text-[#9cb1c6] transition hover:bg-[#f5f8fa] hover:text-[#33475b]"
                aria-label="Cerrar modal de créditos"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-6 rounded-[4px] border border-[#99f6e4] bg-[#f0fdfa] p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#00bda5]">
                Resumen de capacidad
              </p>
              <div className="mt-4 space-y-3 text-[13px] text-[#33475b]">
                <div className="flex items-center justify-between gap-4">
                  <span className="font-bold">Capacidad actual:</span>
                  <span className="font-bold">{metrics.total} CR</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="font-bold">
                    Paquete adicional {PUBLIC_EXTRA_CREDIT_PACKAGE.credits} CR:
                  </span>
                  <span className="font-bold">{formatCurrency(PUBLIC_EXTRA_CREDIT_PACKAGE.price)}</span>
                </div>
                <div className="border-t border-[#99f6e4] pt-3">
                  <div className="flex items-center justify-between gap-4 text-[14px] font-bold text-[#00bda5]">
                    <span>Créditos totales:</span>
                    <span>{extraPackageResultingCredits} CR</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setIsExtraCreditsModalOpen(false)}
                className="inline-flex h-10 flex-1 items-center justify-center rounded-[4px] border border-[#dfe3eb] bg-white px-4 text-[13px] font-bold text-[#33475b] transition hover:bg-[#f5f8fa]"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={() => void startStripeCheckout("extra_package")}
                disabled={isStartingPayment || isSyncingPayment}
                className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-[4px] bg-[#ff7a59] px-4 text-[13px] font-bold text-white transition hover:bg-[#dc6548] disabled:cursor-not-allowed disabled:opacity-70"
              >
                <CreditCard className="h-4 w-4" />
                {isStartingPayment || isSyncingPayment ? "Confirmando pago..." : "Pagar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <FeedbackToast feedback={feedback} onClose={() => setFeedback(null)} />
    </div>
  );
}
