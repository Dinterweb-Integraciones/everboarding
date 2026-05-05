"use client";

import { CalendarDays, Link2, PencilLine, Plus, Sparkles, Trash2, X } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { BrandLogo } from "@/components/layout/brand-logo";
import { FeedbackToast } from "@/components/ui/feedback-toast";
import {
  SALES_PROPOSAL_UPSELL_OPTIONS,
  STATUS_META,
  TASK_STATUS_META,
} from "@/lib/constants";
import {
  createProposalSubitemFromCatalog,
  createEmptySalesInitiative,
  createEmptySalesProposalDraft,
  createLocalId,
  generateSalesProposalSlug,
  getAssigneeName,
  type SalesProposalDraft,
  type SalesProposalInitiativeDraft,
  type SalesProposalRecord,
  calculateSalesInitiativeCredits,
  calculateSalesInitiativeProgress,
  calculateSalesProposalMetrics,
} from "@/lib/sales-proposals";
import {
  formatDateRange,
  type AssignableUser,
  type CreditCatalogGroup,
  type CreditCatalogGroupItem,
  type CreditCatalogItem,
  type InitiativeStatus,
} from "@/lib/onboarding";
import { formatCurrency, formatUserError, safeParseNumber } from "@/lib/utils";

type SalesProposalWorkspaceProps = {
  initialCatalog: CreditCatalogItem[];
  initialGroups: CreditCatalogGroup[];
  initialGroupMemberships: CreditCatalogGroupItem[];
  csmOptions: AssignableUser[];
  initialProposal?: SalesProposalRecord | null;
};

type CatalogModalGroup = {
  id: string;
  name: string;
  description: string;
  modalCategory: string;
  credits: number;
  sortOrder: number;
  items: CreditCatalogItem[];
};

const boardStatuses: InitiativeStatus[] = ["backlog", "planned", "executing", "completed"];
const fieldLabelClass =
  "text-[9px] font-bold uppercase tracking-[0.18em] text-[#9cb1c6]";
const fieldClass =
  "h-8 w-full rounded-[2px] border border-[#cbd6e2] bg-white px-3 text-[12px] text-[#33475b] outline-none transition focus:border-[#00bda5]";

function getStatusDot(status: InitiativeStatus) {
  if (status === "executing") return "bg-[#00bda5]";
  if (status === "planned") return "bg-[#6a78d1]";
  if (status === "completed") return "bg-[#33475b]";
  return "bg-[#cbd6e2]";
}

function getStatusLabel(status: InitiativeStatus) {
  return STATUS_META[status].label;
}

function formatSalesHeaderDate(date: string) {
  if (!date) return "--";

  return new Date(`${date}T00:00:00`).toLocaleDateString("es-NI", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
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

function startOfCalendarMonth(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

function diffCalendarDays(left: Date, right: Date) {
  const leftCopy = new Date(left.getFullYear(), left.getMonth(), left.getDate());
  const rightCopy = new Date(right.getFullYear(), right.getMonth(), right.getDate());
  return Math.round((rightCopy.getTime() - leftCopy.getTime()) / (1000 * 60 * 60 * 24));
}

function minCalendarDate(values: Date[]) {
  return values.reduce((earliest, current) => (current < earliest ? current : earliest));
}

function createEditorDraft(initiative: SalesProposalInitiativeDraft) {
  return {
    ...initiative,
    subitems: initiative.subitems.map((subitem) => ({ ...subitem })),
  };
}

function normalizeCatalogText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function SalesProposalWorkspace({
  initialCatalog,
  initialGroups,
  initialGroupMemberships,
  csmOptions,
  initialProposal,
}: SalesProposalWorkspaceProps) {
  const wizardChallenges = {
    Sales: [
      {
        id: "pipeline_visibility",
        label: "Tener visibilidad del pipeline",
        description: "Saber exactamente en que etapa esta cada negocio.",
        keywords: ["pipeline", "visibilidad", "forecast"],
      },
      {
        id: "followup_automation",
        label: "Seguimiento automatizado",
        description: "Menos tareas manuales, mas automatizacion.",
        keywords: ["seguimiento", "tarea", "automat"],
      },
      {
        id: "prospecting",
        label: "Mejorar la prospeccion",
        description: "Agendar y contactar prospectos de forma efectiva.",
        keywords: ["prospe", "agenda", "meeting"],
      },
    ],
    Marketing: [
      {
        id: "lead_capture",
        label: "Captar mas leads",
        description: "Formularios y conversion optimizados.",
        keywords: ["lead", "capta", "formulario"],
      },
      {
        id: "lead_nurturing",
        label: "Nutrir leads automaticamente",
        description: "Workflows para madurar contactos.",
        keywords: ["nutri", "workflow", "automat"],
      },
      {
        id: "segmentation",
        label: "Segmentar la base de datos",
        description: "Organizar leads para una comunicacion asertiva.",
        keywords: ["segment", "clasif", "base"],
      },
    ],
    Service: [
      {
        id: "ticket_order",
        label: "Ordenar la atencion de tickets",
        description: "Centralizar solicitudes en un solo lugar.",
        keywords: ["ticket", "soporte", "inbox"],
      },
      {
        id: "support_automation",
        label: "Automatizar respuestas",
        description: "Reducir tiempos de espera del cliente.",
        keywords: ["automat", "respuesta", "asign"],
      },
      {
        id: "self_service",
        label: "Habilitar autoservicio",
        description: "Crear articulos y respuestas a preguntas frecuentes.",
        keywords: ["knowledge", "base", "articulo"],
      },
    ],
    Content: [
      {
        id: "website_launch",
        label: "Lanzar sitio web o landing pages",
        description: "Publicar contenido rapidamente.",
        keywords: ["web", "landing", "pagina"],
      },
      {
        id: "seo",
        label: "Mejorar posicionamiento SEO",
        description: "Optimizar activos para buscadores.",
        keywords: ["seo", "optimiz", "meta"],
      },
      {
        id: "blog",
        label: "Estructurar un blog",
        description: "Atraer trafico organico con articulos.",
        keywords: ["blog", "editor", "contenido"],
      },
    ],
  } as const;

  const router = useRouter();
  const [proposal, setProposal] = useState<SalesProposalDraft>(
    initialProposal ?? createEmptySalesProposalDraft(),
  );
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isActivating, setIsActivating] = useState(false);
  const [isUpsellModalOpen, setIsUpsellModalOpen] = useState(false);
  const [upsellPackageCredits, setUpsellPackageCredits] = useState<number>(
    SALES_PROPOSAL_UPSELL_OPTIONS[0].credits,
  );
  const [upsellCartCount, setUpsellCartCount] = useState(0);
  const [catalogSelections, setCatalogSelections] = useState<Record<InitiativeStatus, string>>({
    backlog: "",
    planned: "",
    executing: "",
    completed: "",
  });
  const [isCatalogModalOpen, setIsCatalogModalOpen] = useState(false);
  const [activeCatalogTab, setActiveCatalogTab] = useState<string>("wizard");
  const [catalogPreviewGroup, setCatalogPreviewGroup] = useState<CatalogModalGroup | null>(null);
  const [wizardHubs, setWizardHubs] = useState<string[]>([]);
  const [wizardPortalState, setWizardPortalState] = useState<"new" | "optimize">("new");
  const [wizardChallenge, setWizardChallenge] = useState<string>("");
  const [editingInitiativeId, setEditingInitiativeId] = useState<string | null>(null);
  const [initiativeDraft, setInitiativeDraft] = useState<SalesProposalInitiativeDraft | null>(null);

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
    const itemById = new Map(initialCatalog.map((item) => [item.id, item]));
    const membershipsByGroup = new Map<string, CreditCatalogGroupItem[]>();

    initialGroupMemberships.forEach((membership) => {
      const bucket = membershipsByGroup.get(membership.group_id) ?? [];
      bucket.push(membership);
      membershipsByGroup.set(membership.group_id, bucket);
    });

    return initialGroups
      .filter((group) => group.is_active && (group.modal_category ?? "").trim())
      .map((group) => {
        const items = (membershipsByGroup.get(group.id) ?? [])
          .sort(
            (left, right) =>
              safeParseNumber(left.sort_order) - safeParseNumber(right.sort_order),
          )
          .map((membership) => itemById.get(membership.catalog_item_id))
          .filter((item): item is CreditCatalogItem => Boolean(item));

        const credits = items.length
          ? items.reduce((sum, item) => sum + safeParseNumber(item.credits), 0)
          : Math.max(0, safeParseNumber(group.credits));

        return {
          id: group.id,
          name: group.name,
          description: group.description?.trim() || "",
          modalCategory: (group.modal_category ?? "").trim(),
          credits,
          sortOrder: safeParseNumber(group.sort_order),
          items,
        } satisfies CatalogModalGroup;
      })
      .sort(
        (left, right) =>
          left.sortOrder - right.sortOrder || left.name.localeCompare(right.name),
      );
  }, [initialCatalog, initialGroups, initialGroupMemberships]);

  const catalogGroupOptions = useMemo(() => {
    const grouped = new Map<string, CatalogModalGroup[]>();

    catalogGroups.forEach((group) => {
      const bucket = grouped.get(group.modalCategory) ?? [];
      bucket.push(group);
      grouped.set(group.modalCategory, bucket);
    });

    return Array.from(grouped.entries()).map(
      ([category, groups]) =>
        [
          category,
          [...groups].sort(
            (left, right) =>
              left.sortOrder - right.sortOrder || left.name.localeCompare(right.name),
          ),
        ] as const,
    );
  }, [catalogGroups]);

  const catalogTabs = useMemo(
    () => [
      { id: "wizard", label: "Guía de Activación" },
      ...catalogGroupOptions.map(([category]) => ({ id: category, label: category })),
    ],
    [catalogGroupOptions],
  );

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

  const timelineRows = useMemo(() => {
    const today = new Date();
    const baseDateCandidates = [today];

    if (proposal.startDate) {
      baseDateCandidates.push(parseCalendarDate(proposal.startDate));
    }

    const datedRows = proposal.initiatives
      .map((initiative) => {
        const start = initiative.estStartDate ? parseCalendarDate(initiative.estStartDate) : null;
        const end = initiative.estEndDate ? parseCalendarDate(initiative.estEndDate) : null;

        if (start) baseDateCandidates.push(start);
        if (end) baseDateCandidates.push(end);

        return { initiative, start, end };
      })
      .sort((left, right) => {
        if (!left.start) return 1;
        if (!right.start) return -1;
        return left.start.getTime() - right.start.getTime();
      });

    const windowStart = startOfCalendarMonth(minCalendarDate(baseDateCandidates));
    const windowEnd = addCalendarMonths(windowStart, 3);
    const timelineDays = Math.max(diffCalendarDays(windowStart, windowEnd), 1);
    const monthSegments = Array.from({ length: 3 }, (_, index) => {
      const monthStart = addCalendarMonths(windowStart, index);
      const nextMonthStart = addCalendarMonths(windowStart, index + 1);
      const days = diffCalendarDays(monthStart, nextMonthStart);

      return {
        key: `${monthStart.getFullYear()}-${monthStart.getMonth() + 1}`,
        label: new Intl.DateTimeFormat("es-NI", {
          month: "long",
          year: "numeric",
        }).format(monthStart),
        days,
      };
    });

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
  }, [proposal.initiatives, proposal.startDate]);

  function openInitiativeEditor(initiative: SalesProposalInitiativeDraft) {
    setEditingInitiativeId(initiative.id);
    setInitiativeDraft(createEditorDraft(initiative));
  }

  function closeInitiativeEditor() {
    setEditingInitiativeId(null);
    setInitiativeDraft(null);
  }

  function addInitiative(status: InitiativeStatus) {
    const next = createEmptySalesInitiative(status);
    next.sortOrder = groupedInitiatives[status].length;
    setEditingInitiativeId(next.id);
    setInitiativeDraft(next);
  }

  function saveInitiativeDraft() {
    if (!initiativeDraft) return;

    if (!initiativeDraft.title.trim()) {
      setFeedback({ tone: "error", message: "Agrega un titulo para la iniciativa." });
      return;
    }

    if (!initiativeDraft.subitems.length) {
      setFeedback({ tone: "error", message: "Agrega al menos una actividad al plan." });
      return;
    }

    setProposal((current) => {
      const exists = current.initiatives.some((initiative) => initiative.id === initiativeDraft.id);
      const nextInitiatives = exists
        ? current.initiatives.map((initiative) =>
            initiative.id === initiativeDraft.id ? createEditorDraft(initiativeDraft) : initiative,
          )
        : [...current.initiatives, createEditorDraft(initiativeDraft)];

      return { ...current, initiatives: nextInitiatives };
    });
    closeInitiativeEditor();
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

  function quickAddCatalogItem(status: InitiativeStatus) {
    const selectedId = catalogSelections[status];
    if (!selectedId) return;

    const item = initialCatalog.find((catalogItem) => catalogItem.id === selectedId);
    if (!item) return;

    const next = createEmptySalesInitiative(status);
    next.id = createLocalId("sales-initiative");
    next.title = item.label;
    next.type = item.category;
    next.subitems = [createProposalSubitemFromCatalog(item)];
    next.estStartDate = proposal.startDate;
    next.estEndDate = proposal.startDate;
    next.sortOrder = groupedInitiatives[status].length;

    setProposal((current) => ({
      ...current,
      initiatives: [...current.initiatives, next],
    }));
    setCatalogSelections((current) => ({ ...current, [status]: "" }));
  }

  function openCatalogModal(tab: string = "wizard") {
    setActiveCatalogTab(tab);
    setIsCatalogModalOpen(true);
  }

  function closeCatalogModal() {
    setIsCatalogModalOpen(false);
    setCatalogPreviewGroup(null);
  }

  function openUpsellModal() {
    setUpsellPackageCredits(SALES_PROPOSAL_UPSELL_OPTIONS[0].credits);
    setUpsellCartCount(0);
    setIsUpsellModalOpen(true);
  }

  function closeUpsellModal() {
    setIsUpsellModalOpen(false);
  }

  function addUpsellPackage() {
    setUpsellCartCount((current) => current + 1);
  }

  function removeUpsellPackage() {
    setUpsellCartCount((current) => Math.max(0, current - 1));
  }

  function confirmUpsell() {
    if (!upsellCartCount) {
      closeUpsellModal();
      return;
    }

    const addedCredits = upsellPackageCredits * upsellCartCount;
    const addedPrice = upsellPackagePrice * upsellCartCount;

    setProposal((current) => ({
      ...current,
      contractedCredits: current.contractedCredits + addedCredits,
      quotedPrice: current.quotedPrice + addedPrice,
    }));
    setFeedback({
      tone: "success",
      message: `Capacidad incrementada en ${addedCredits} creditos.`,
    });
    closeUpsellModal();
  }

  function createInitiativeFromGroup(
    group: CatalogModalGroup,
    status: InitiativeStatus,
    sortOrder: number,
  ) {
    const next = createEmptySalesInitiative(status);
    next.id = createLocalId("sales-initiative");
    next.title = group.name;
    next.type = group.modalCategory || group.name;
    next.description =
      group.description || `Grupo de casos de uso recomendado para ${group.modalCategory}.`;
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
    next.estStartDate = proposal.startDate;
    next.estEndDate = proposal.startDate;
    next.sortOrder = sortOrder;

    return next;
  }

  function openCatalogGroupPreview(group: CatalogModalGroup) {
    setCatalogPreviewGroup(group);
  }

  function closeCatalogGroupPreview() {
    setCatalogPreviewGroup(null);
  }

  function addCatalogPreviewGroup(status: InitiativeStatus) {
    if (!catalogPreviewGroup) return;

    const next = createInitiativeFromGroup(
      catalogPreviewGroup,
      status,
      groupedInitiatives[status].length,
    );

    setProposal((current) => ({
      ...current,
      initiatives: [...current.initiatives, next],
    }));
    setCatalogPreviewGroup(null);
    setIsCatalogModalOpen(false);
    setFeedback({
      tone: "success",
      message:
        status === "planned"
          ? "Grupo incluido en Planificacion."
          : "Grupo enviado a Evaluacion.",
    });
  }

  function toggleWizardHub(hub: string) {
    setWizardHubs((current) => {
      const next = current.includes(hub) ? current.filter((value) => value !== hub) : [...current, hub];
      if (!next.length || next[0] !== current[0]) {
        setWizardChallenge("");
      }
      return next;
    });
  }

  function findCatalogGroupsByCategory(category: string) {
    return (
      catalogGroupOptions.find(
        ([entryCategory]) =>
          normalizeCatalogText(entryCategory) === normalizeCatalogText(category),
      )?.[1] ?? []
    );
  }

  function findCatalogGroupByKeywords(category: string, keywords: readonly string[]) {
    const normalizedKeywords = keywords.map((keyword) => normalizeCatalogText(keyword));
    const candidates = findCatalogGroupsByCategory(category);

    const scored = candidates
      .map((group) => {
        const haystack = normalizeCatalogText(
          [
            group.name,
            group.description,
            ...group.items.map((item) => `${item.label} ${item.category}`),
          ].join(" "),
        );
        const score = normalizedKeywords.reduce(
          (sum, keyword) => sum + (haystack.includes(keyword) ? 1 : 0),
          0,
        );

        return { group, score };
      })
      .sort(
        (left, right) =>
          right.score - left.score || left.group.sortOrder - right.group.sortOrder,
      );

    return scored[0]?.score ? scored[0].group : candidates[0] ?? null;
  }

  function applyWizardRecommendations() {
    if (!wizardHubs.length || !wizardChallenge) {
      setFeedback({
        tone: "error",
        message: "Completa la Guia de Activacion antes de generar el plan.",
      });
      return;
    }

    const existingTitles = new Set(
      proposal.initiatives.map((initiative) => normalizeCatalogText(initiative.title)),
    );
    const nextInitiatives = [...proposal.initiatives];
    let nextSortOrder = proposal.initiatives.length;

    const pushInitiativeFromGroup = (group: CatalogModalGroup | null, status: InitiativeStatus) => {
      if (!group || existingTitles.has(normalizeCatalogText(group.name))) {
        return;
      }

      const initiative = createInitiativeFromGroup(group, status, nextSortOrder);

      nextSortOrder += 1;
      existingTitles.add(normalizeCatalogText(group.name));
      nextInitiatives.push(initiative);
    };

    if (!existingTitles.has(normalizeCatalogText("Sesión Kickoff"))) {
      const kickoff = createEmptySalesInitiative("executing");
      kickoff.id = createLocalId("sales-initiative");
      kickoff.title = "Sesión Kickoff";
      kickoff.type = "Implementación";
      kickoff.description =
        "Alineación estratégica inicial para definir prioridades y próximos pasos.";
      kickoff.estStartDate = proposal.startDate;
      kickoff.estEndDate = proposal.startDate;
      kickoff.sortOrder = nextSortOrder;
      nextSortOrder += 1;
      existingTitles.add(normalizeCatalogText(kickoff.title));
      nextInitiatives.push(kickoff);
    }

    findCatalogGroupsByCategory("Fundamentales")
      .slice(0, 2)
      .forEach((group) => pushInitiativeFromGroup(group, "planned"));

    const primaryHub = wizardHubs[0];
    const primaryChallenges = wizardChallenges[primaryHub as keyof typeof wizardChallenges] ?? [];
    const selectedChallenge = primaryChallenges.find((challenge) => challenge.id === wizardChallenge);

    if (selectedChallenge) {
      pushInitiativeFromGroup(
        findCatalogGroupByKeywords(primaryHub, selectedChallenge.keywords),
        "planned",
      );
    }

    wizardHubs.forEach((hub, index) => {
      const categoryGroups = findCatalogGroupsByCategory(hub);
      const preferredCount = wizardPortalState === "optimize" ? (index === 0 ? 3 : 2) : 2;

      categoryGroups.slice(0, preferredCount).forEach((group, itemIndex) => {
        const status: InitiativeStatus = index === 0 && itemIndex < 2 ? "planned" : "backlog";
        pushInitiativeFromGroup(group, status);
      });
    });

    setProposal((current) => ({
      ...current,
      initiatives: nextInitiatives.map((initiative, index) => ({
        ...initiative,
        sortOrder: index,
      })),
    }));
    setIsCatalogModalOpen(false);
    setFeedback({
      tone: "success",
      message: "Plan de trabajo generado desde la Guia de Activacion.",
    });
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

  async function saveProposal() {
    setFeedback(null);
    setIsSaving(true);

    try {
      const slug = proposal.slug || generateSalesProposalSlug(proposal);
      const response = await fetch(
        proposal.slug ? `/api/sales-proposals/${proposal.slug}` : "/api/sales-proposals",
        {
          method: proposal.slug ? "PUT" : "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ...proposal, slug }),
        },
      );

      const payload = (await response.json()) as SalesProposalRecord & { message?: string };

      if (!response.ok) {
        throw new Error(payload.message || "No pudimos guardar la propuesta.");
      }

      setProposal(payload);
      if (!proposal.slug) {
        router.replace(`/sales/proposals/${payload.slug}`);
      }

      setFeedback({ tone: "success", message: "Propuesta guardada correctamente." });
    } catch (caughtError) {
      setFeedback({
        tone: "error",
        message: formatUserError(caughtError, "No pudimos guardar la propuesta comercial."),
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function activatePlan() {
    setFeedback(null);
    setIsActivating(true);

    try {
      let targetSlug = proposal.slug;

      if (!targetSlug) {
        const generatedSlug = generateSalesProposalSlug(proposal);
        const createResponse = await fetch("/api/sales-proposals", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ...proposal, slug: generatedSlug }),
        });

        const createPayload = (await createResponse.json()) as SalesProposalRecord & {
          message?: string;
        };

        if (!createResponse.ok) {
          throw new Error(createPayload.message || "No pudimos preparar la propuesta.");
        }

        targetSlug = createPayload.slug;
        setProposal(createPayload);
        router.replace(`/sales/proposals/${createPayload.slug}`);
      }

      const response = await fetch(`/api/sales-proposals/${targetSlug}/activate`, {
        method: "POST",
      });
      const payload = (await response.json()) as { url?: string; message?: string };

      if (!response.ok || !payload.url) {
        throw new Error(payload.message || "No pudimos activar el plan.");
      }

      window.location.href = payload.url;
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

  async function copyShareLink() {
    if (!proposal.slug) {
      setFeedback({
        tone: "error",
        message: "Guarda la propuesta antes de compartirla.",
      });
      return;
    }

    const shareUrl = `${window.location.origin}/sales/proposals/${proposal.slug}`;
    await navigator.clipboard.writeText(shareUrl);
    setFeedback({ tone: "success", message: "Enlace de propuesta copiado." });
  }

  const proposalStatusLabel =
    proposal.status === "board_activated"
      ? "Board activado"
      : proposal.status === "paid"
        ? "Pagada"
        : proposal.status === "checkout_pending"
          ? "Checkout pendiente"
          : "Borrador";
  const consumedWidth = Math.min((metrics.completed / Math.max(metrics.total, 1)) * 100, 100);
  const committedWidth = Math.min((metrics.committed / Math.max(metrics.total, 1)) * 100, 100);
  const availableWidth = Math.min((metrics.available / Math.max(metrics.total, 1)) * 100, 100);
  const hasPlanningItems =
    groupedInitiatives.backlog.length > 0 || groupedInitiatives.planned.length > 0;
  const isOverCapacity = metrics.committed + metrics.completed > metrics.total;
  const upsellPackagePrice =
    SALES_PROPOSAL_UPSELL_OPTIONS.find((option) => option.credits === upsellPackageCredits)?.price ??
    SALES_PROPOSAL_UPSELL_OPTIONS[0].price;
  const upsellCreditsAdded = upsellPackageCredits * upsellCartCount;
  const upsellTotalPrice = proposal.quotedPrice + upsellPackagePrice * upsellCartCount;

  return (
    <div className="min-h-screen bg-[#fcfcfc] pb-14 text-[#33475b]">
      <header className="sticky top-0 z-30 border-b border-[#dfe3eb] bg-white shadow-sm">
        <div className="flex items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-6">
            <BrandLogo href="/sales/proposals/new" priority />
          </div>
          <div className="flex items-center gap-4 text-[12.5px] font-medium text-[#516f90]">
            <button
              type="button"
              onClick={() => setProposal(createEmptySalesProposalDraft())}
              className="inline-flex items-center gap-1.5 transition hover:text-[#ff7a59]"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Limpiar
            </button>
            <span className="h-4 w-px bg-[#dfe3eb]" />
            <button
              type="button"
              onClick={copyShareLink}
              className="inline-flex items-center gap-1.5 font-semibold text-[#00bda5] transition hover:text-[#009c88]"
            >
              <Link2 className="h-3.5 w-3.5" />
              Compartir Link
            </button>
          </div>
        </div>
      </header>

      <main className="w-full">
        <section className="border-b border-[#dfe3eb] bg-white px-6 py-4">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex-1 space-y-4">
              <div className="flex flex-wrap items-center gap-4">
                <div className="min-w-[160px]">
                  <input
                    value={proposal.clientName}
                    onChange={(event) => setProposal({ ...proposal, clientName: event.target.value })}
                    className="w-full border-0 border-b border-transparent bg-transparent p-0 text-[15px] font-bold leading-none text-[#33475b] outline-none transition focus:border-[#00bda5]"
                  />
                </div>
                <span className="hidden h-4 w-px bg-[#dfe3eb] md:block" />
                <div className="flex items-center gap-2 rounded-[4px] px-1.5 py-1 text-[12px] font-medium text-[#516f90] transition hover:bg-[#f5f8fa]">
                  <CalendarDays className="h-3.5 w-3.5" />
                  <span>Inicio: {formatSalesHeaderDate(proposal.startDate)}</span>
                </div>
                <span className="inline-flex items-center rounded-[4px] border border-[#dfe3eb] bg-[#f5f8fa] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[#516f90]">
                  {proposalStatusLabel}
                </span>
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

            <div className="w-full max-w-[430px] rounded-[6px] border border-[#cbd6e2] bg-white shadow-sm transition hover:shadow-md">
              <div className="flex items-stretch">
                <div className="flex min-w-[132px] flex-col justify-center px-3 py-2">
                  <p className="text-[7px] font-bold uppercase tracking-[0.16em] text-[#9cb1c6]">
                    Inversión total
                  </p>
                  <p className="mt-1 text-[12px] font-extrabold leading-none text-[#33475b]">
                    {formatCurrency(proposal.quotedPrice, proposal.currency.toUpperCase())}
                  </p>
                </div>
                <div className="my-1 w-px bg-[#dfe3eb]" />
                <div className="flex items-center px-2.5">
                  <span className="inline-flex h-8 items-center rounded-[2px] border border-[#9fe7dc] bg-[#ecfffb] px-2 text-[10px] font-bold text-[#00bda5]">
                    {proposal.contractedCredits} CR
                  </span>
                </div>
                <div className="my-1 w-px bg-[#dfe3eb]" />
                <div className="flex items-center px-1.5">
                  <button
                    type="button"
                    onClick={openUpsellModal}
                    className="grid h-7 w-7 place-items-center rounded-[4px] border border-[#cbd6e2] bg-[#f5f8fa] text-[#516f90] transition hover:border-[#ff7a59] hover:bg-[#ff7a59] hover:text-white"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
                <div className="my-1 w-px bg-[#dfe3eb]" />
                <div className="flex items-center px-1.5 py-1">
                  <button
                    type="button"
                    onClick={activatePlan}
                    disabled={isActivating}
                    className="inline-flex h-10 items-center gap-2 rounded-[4px] bg-[#ff7a59] px-5 text-[13px] font-bold text-white transition hover:bg-[#dc6548] disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {isActivating ? "Activando..." : "Activar Plan"}
                    <Sparkles className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 flex h-1.5 w-full overflow-hidden rounded-full bg-[#eaf0f6]">
            <div className="h-full bg-[#33475b]" style={{ width: `${consumedWidth}%` }} />
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
                className="inline-flex h-8 items-center justify-center rounded-[3px] bg-[#ff7a59] px-3 text-[11px] font-bold text-white transition hover:bg-[#dc6548]"
              >
                Anadir creditos
              </button>
            </div>
          ) : null}

          <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-2">
              <span className={fieldLabelClass}>Empresa</span>
              <input
                value={proposal.clientCompany}
                onChange={(event) => setProposal({ ...proposal, clientCompany: event.target.value })}
                className={fieldClass}
                placeholder="Empresa cliente"
              />
            </label>
            <label className="space-y-2">
              <span className={fieldLabelClass}>Email cliente</span>
              <input
                value={proposal.clientEmail}
                onChange={(event) => setProposal({ ...proposal, clientEmail: event.target.value })}
                className={fieldClass}
                placeholder="cliente@empresa.com"
              />
            </label>
            <label className="space-y-2">
              <span className={fieldLabelClass}>CSM asignado</span>
              <select
                value={proposal.assignedCsmUserId}
                onChange={(event) => setProposal({ ...proposal, assignedCsmUserId: event.target.value })}
                className={fieldClass}
              >
                <option value="">Selecciona un CSM</option>
                {csmOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.full_name || option.email}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2">
              <span className={fieldLabelClass}>Inicio</span>
              <input
                type="date"
                value={proposal.startDate}
                onChange={(event) => setProposal({ ...proposal, startDate: event.target.value })}
                className={fieldClass}
              />
            </label>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <label className="space-y-2">
              <span className={fieldLabelClass}>
                Créditos contratados
              </span>
              <input
                type="number"
                min={0}
                value={proposal.contractedCredits}
                onChange={(event) =>
                  setProposal({ ...proposal, contractedCredits: Math.max(0, safeParseNumber(event.target.value)) })
                }
                className={fieldClass}
              />
            </label>
            <label className="space-y-2">
              <span className={fieldLabelClass}>
                Inversión
              </span>
              <input
                type="number"
                min={0}
                value={proposal.quotedPrice}
                onChange={(event) =>
                  setProposal({ ...proposal, quotedPrice: Math.max(0, safeParseNumber(event.target.value)) })
                }
                className={fieldClass}
              />
            </label>
            <label className="space-y-2">
              <span className={fieldLabelClass}>
                Periodo
              </span>
              <select
                value={proposal.periodMonths}
                onChange={(event) =>
                  setProposal({ ...proposal, periodMonths: Number(event.target.value) as 1 | 3 | 6 | 12 })
                }
                className={fieldClass}
              >
                <option value={1}>Mensual</option>
                <option value={3}>Trimestral</option>
                <option value={6}>Semestral</option>
                <option value={12}>Anual</option>
              </select>
            </label>
            <label className="space-y-2">
              <span className={fieldLabelClass}>
                Cobro
              </span>
              <select
                value={proposal.billingMode}
                onChange={(event) =>
                  setProposal({
                    ...proposal,
                    billingMode: event.target.value === "one_time" ? "one_time" : "subscription",
                  })
                }
                className={fieldClass}
              >
                <option value="subscription">Membresía</option>
                <option value="one_time">Pago único</option>
              </select>
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={saveProposal}
              disabled={isSaving}
              className="inline-flex h-9 items-center gap-2 rounded-[3px] border border-[#cbd6e2] bg-white px-4 text-[12px] font-bold text-[#33475b] transition hover:bg-[#f5f8fa] disabled:cursor-not-allowed disabled:opacity-70"
            >
              <PencilLine className="h-3.5 w-3.5" />
              {isSaving ? "Guardando..." : "Guardar propuesta"}
            </button>
            {proposal.slug ? (
              <span className="inline-flex h-9 items-center gap-2 rounded-[3px] bg-[#f5f8fa] px-3 text-[11px] font-bold text-[#516f90]">
                {proposal.status === "board_activated"
                  ? "Board activado"
                  : proposal.status === "paid"
                    ? "Pagada"
                    : proposal.status === "checkout_pending"
                      ? "Checkout pendiente"
                      : "Borrador"}
              </span>
            ) : null}
          </div>
        </section>

        <section className="border-b border-[#dfe3eb] bg-[#f5f8fa] px-6 py-6">
          <div className="overflow-x-auto overflow-y-hidden">
            <div className="flex min-h-[420px] min-w-max gap-6">
              {boardStatuses.map((status) => {
                if (!hasPlanningItems && status === "planned") {
                  return null;
                }

                const items = groupedInitiatives[status];
                const totalCredits = items.reduce(
                  (sum, initiative) => sum + calculateSalesInitiativeCredits(initiative),
                  0,
                );
                const allowsCreate = status === "backlog" || status === "planned";

                if (!hasPlanningItems && status === "backlog") {
                  return (
                    <div
                      key="planning-empty-state"
                      className="flex min-w-[666px] flex-col"
                    >
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
                            onClick={() => openCatalogModal("wizard")}
                            className="mt-8 inline-flex min-w-[282px] items-center justify-center gap-2 rounded-[4px] bg-[#14b8a6] px-8 py-3.5 text-[14px] font-extrabold text-white shadow-md transition hover:-translate-y-0.5 hover:bg-[#0ea899]"
                          >
                            <Sparkles className="h-4 w-4" />
                            Guía Inteligente
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={status} className="flex w-[320px] min-w-[320px] max-w-[340px] flex-col">
                    <div className="mb-2 flex items-center justify-between px-1">
                      <div className="flex items-center gap-2">
                        <span className={`h-2.5 w-2.5 rounded-full ${getStatusDot(status)}`} />
                        <p className="text-[13px] font-bold uppercase tracking-[0.18em] text-[#516f90]">
                          {getStatusLabel(status)}
                        </p>
                      </div>
                      <span className="rounded-[2px] bg-[#eaf0f6] px-2 py-0.5 text-[11px] font-bold text-[#516f90]">
                        {totalCredits} CR
                      </span>
                    </div>

                    <div className="min-h-[360px] flex-1 space-y-2 rounded-[6px] border border-[#dfe3eb] bg-[#f5f8fa] p-2">
                      {items.map((initiative) => {
                        const credits = calculateSalesInitiativeCredits(initiative);
                        const progress = calculateSalesInitiativeProgress(initiative);

                        return (
                          <button
                            key={initiative.id}
                            type="button"
                            onClick={() => openInitiativeEditor(initiative)}
                            className="relative w-full rounded-[5px] border border-[#dfe3eb] bg-white p-3 text-left shadow-sm transition hover:-translate-y-[1px] hover:border-[#cbd6e2] hover:shadow-md"
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
                                className={`${progress >= 100 ? "bg-[#33475b]" : progress >= 60 ? "bg-[#00bda5]" : progress > 0 ? "bg-[#6a78d1]" : "bg-[#cbd6e2]"} h-full`}
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                            <div className="pl-1">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <h4 className="text-[13px] font-bold text-[#33475b]">{initiative.title}</h4>
                                    <span className="rounded-[2px] bg-[#f5f8fa] px-1.5 py-0.5 text-[9px] font-bold text-[#516f90]">
                                      {progress}%
                                    </span>
                                  </div>
                                  <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-[#516f90]">
                                    {initiative.description || "Sin descripción ejecutiva."}
                                  </p>
                                </div>
                                <span className="rounded-[3px] bg-[#eaf0f6] px-1.5 py-0.5 text-[11px] font-bold text-[#33475b]">
                                  {credits} CR
                                </span>
                              </div>
                              <div className="mt-3 inline-flex rounded-[3px] border border-[#f8c75c] bg-[#fff7dc] px-2 py-0.5 text-[9px] font-bold text-[#d97706]">
                                {formatDateRange(initiative.estStartDate || null, initiative.estEndDate || null)}
                              </div>
                            </div>
                          </button>
                        );
                      })}

                      {allowsCreate ? (
                        <div className="rounded-[4px] border-2 border-dashed border-[#00bda5] bg-[#f0fdfa] p-2 shadow-sm">
                          <div className="grid grid-cols-[1fr_auto] gap-2">
                            <select
                              value={catalogSelections[status]}
                              onChange={(event) =>
                                setCatalogSelections((current) => ({
                                  ...current,
                                  [status]: event.target.value,
                                }))
                              }
                              className="h-9 w-full rounded-[2px] border border-[#cbd6e2] bg-white px-3 text-[11px] font-medium outline-none transition focus:border-[#00bda5]"
                            >
                              <option value="">-- Rápido --</option>
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
                              onClick={() => quickAddCatalogItem(status)}
                              className="rounded-[3px] border border-[#cbd6e2] bg-white px-3 text-[11px] font-bold text-[#33475b] transition hover:border-[#00bda5] hover:text-[#00bda5]"
                            >
                              Añadir
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => addInitiative(status)}
                            className="mt-2 w-full rounded-[4px] px-3 py-2 text-[12px] font-bold text-[#00bda5] transition hover:bg-[#00bda5] hover:text-white"
                          >
                            + Añadir Caso de Uso
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
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
              Proyección estratégica inicial. Puedes mover las prioridades antes de activar el plan.
            </p>
          </div>

          <div className="mt-6 overflow-x-auto pb-2">
            <div className="min-w-[1160px] overflow-hidden rounded-[6px] border border-[#dfe3eb] bg-white shadow-sm">
              <div
                className="grid min-w-[1120px]"
                style={{
                  gridTemplateColumns: `180px minmax(${timelineRows.timelineDays * timelineRows.dayWidth}px, 1fr)`,
                }}
              >
                <div className="border-r border-[#dfe3eb] bg-white" />
                <div className="overflow-hidden border-b border-[#dfe3eb] bg-[#f5f8fa]">
                  <div className="grid" style={{ gridTemplateColumns: `repeat(3, minmax(0, 1fr))` }}>
                    {timelineRows.monthSegments.map((month) => (
                      <div
                        key={month.key}
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
                  timelineRows.rows.map((row) => (
                    <Fragment key={row.initiative.id}>
                      <button
                        type="button"
                        onClick={() => openInitiativeEditor(row.initiative)}
                        className="border-r border-b border-[#eaf0f6] bg-white px-4 py-3 text-left transition hover:bg-[#fcfcfc]"
                      >
                        <p className="line-clamp-2 text-[12px] font-bold text-[#33475b]">
                          {row.initiative.title}
                        </p>
                        <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.14em] text-[#9cb1c6]">
                          {getStatusLabel(row.initiative.status)}
                        </p>
                        <p className="mt-2 text-[9px] font-semibold text-[#8aa0b4]">
                          {row.rangeLabel || "Sin fechas"}
                        </p>
                      </button>
                      <div className="relative border border-[#eaf0f6] border-l-0 border-t-0 bg-white">
                        {timelineRows.todayOffset >= 0 &&
                        timelineRows.todayOffset < timelineRows.timelineDays ? (
                          <div
                            className="pointer-events-none absolute bottom-0 top-0 z-10 w-[1px] bg-[#ff7a59]"
                            style={{ left: `${timelineRows.todayOffset * timelineRows.dayWidth}px` }}
                          />
                        ) : null}
                        <div
                          className="grid"
                          style={{
                            gridTemplateColumns: `repeat(${timelineRows.timelineDays}, ${timelineRows.dayWidth}px)`,
                          }}
                        >
                          {timelineRows.dayMarkers.map((marker) => (
                            <div
                              key={`${row.initiative.id}-${marker.key}`}
                              className="h-[40px] border-r border-[#eef2f7] last:border-r-0"
                            />
                          ))}
                        </div>
                        {!row.isOutsideRange ? (
                          <button
                            type="button"
                            onClick={() => openInitiativeEditor(row.initiative)}
                            className={`absolute top-[8px] flex h-[22px] items-center rounded-[4px] px-3 text-left text-[10px] font-bold text-white shadow-sm ${
                              row.initiative.status === "executing"
                                ? "bg-[#00bda5]"
                                : row.initiative.status === "planned"
                                  ? "bg-[#6a78d1]"
                                  : row.initiative.status === "completed"
                                    ? "bg-[#33475b]"
                                    : "bg-[#54779c]"
                            }`}
                            style={{
                              left: `${row.startOffset * timelineRows.dayWidth}px`,
                              width: `${Math.max(row.span * timelineRows.dayWidth - 4, timelineRows.dayWidth * 2)}px`,
                            }}
                          >
                            <span className="truncate">{row.initiative.title}</span>
                          </button>
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
                )}
              </div>
            </div>
          </div>

          {timelineRows.undatedRows.length > 0 ? (
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
            {boardStatuses.map((status) => {
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
                    {items.map((initiative) => (
                      <button
                        key={`summary-card-${initiative.id}`}
                        type="button"
                        onClick={() => openInitiativeEditor(initiative)}
                        className="grid w-full gap-6 px-5 py-5 text-left transition hover:bg-[#fcfcfc] lg:grid-cols-[1.35fr_0.65fr]"
                      >
                        <div>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <h4 className="text-[14px] font-bold text-[#33475b]">{initiative.title}</h4>
                              <p className="mt-2 text-[11px] leading-5 text-[#516f90]">
                                {initiative.description || "Sin descripción ejecutiva."}
                              </p>
                              <div className="mt-2 inline-flex rounded-[3px] border border-[#f8c75c] bg-[#fff7dc] px-2 py-0.5 text-[9px] font-bold text-[#d97706]">
                                {formatDateRange(initiative.estStartDate || null, initiative.estEndDate || null)}
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
                              Sin notas registradas.
                            </p>
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
      </main>

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
                  <div className="mx-auto max-w-[770px] rounded-[8px] border border-[#dfe3eb] bg-white p-8 shadow-sm">
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
                        <div className="mt-4 space-y-4">
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

                    <div className="mt-10 flex justify-center border-t border-[#eaf0f6] pt-6">
                      <button
                        type="button"
                        onClick={applyWizardRecommendations}
                        disabled={!wizardHubs.length || !wizardChallenge}
                        className="inline-flex items-center gap-2 rounded-[6px] bg-[#14b8a6] px-10 py-3.5 text-[15px] font-bold text-white shadow-md transition hover:bg-[#0ea899] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Sparkles className="h-4 w-4" />
                        Armar Plan de Trabajo
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
                    {(catalogGroupOptions.find(([category]) => category === activeCatalogTab)?.[1] ?? []).map((group) => {
                      const alreadyAdded = proposal.initiatives.some(
                        (initiative) => normalizeCatalogText(initiative.title) === normalizeCatalogText(group.name),
                      );

                      return (
                        <button
                          key={group.id}
                          type="button"
                          onClick={() => openCatalogGroupPreview(group)}
                          disabled={alreadyAdded}
                          className={`flex flex-col rounded-[6px] border p-5 text-left shadow-sm transition ${
                            alreadyAdded
                              ? "cursor-not-allowed border-[#eaf0f6] bg-[#f8fafc] opacity-60"
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
                            {group.description || "Grupo sugerido desde el catalogo para incluirlo dentro de la propuesta comercial."}
                          </p>
                          <div className="mt-auto flex items-center justify-between border-t border-[#eaf0f6] pt-4">
                            <span className="text-[14px] font-bold text-[#ff7a59]">{group.credits} CR</span>
                            <span className={`text-[11px] font-bold ${alreadyAdded ? "text-[#9cb1c6]" : "text-[#00bda5]"}`}>
                              {alreadyAdded ? "Ya agregado" : "Ver detalles"}
                            </span>
                          </div>
                        </button>
                      );
                    })}
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

      {isUpsellModalOpen ? (
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
                  <span className="font-bold">Plan base {proposal.contractedCredits} CR:</span>
                  <span className="font-bold">
                    {formatCurrency(proposal.quotedPrice, proposal.currency.toUpperCase())}
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
                    <span>{proposal.contractedCredits + upsellCreditsAdded} CR</span>
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
        <div className="fixed inset-0 z-40 flex justify-end bg-[#33475b]/60 backdrop-blur-[2px]">
          <button type="button" className="absolute inset-0" onClick={closeInitiativeEditor} aria-label="Cerrar" />
          <aside className="relative h-full w-full max-w-[560px] overflow-y-auto border-l border-[#dfe3eb] bg-white shadow-[-16px_0_40px_rgba(51,71,91,0.12)]">
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
                  {boardStatuses
                    .filter((status) => status !== initiativeDraft.status)
                    .map((status) => (
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
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#516f90]">Descripción</p>
                <textarea
                  rows={4}
                  value={initiativeDraft.description}
                  onChange={(event) => updateInitiativeDraft("description", event.target.value)}
                  className="mt-3 min-h-[72px] w-full rounded-[2px] border border-[#cbd6e2] bg-white px-3 py-2 text-[12px] text-[#516f90] outline-none transition focus:border-[#00bda5]"
                />
              </section>

              <section className="rounded-[6px] border border-[#dfe3eb] bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#516f90]">Actividades incluidas</p>
                  <span className="text-[13px] font-bold text-[#ff7a59]">
                    {calculateSalesInitiativeCredits(initiativeDraft)} CR
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
                  <p className="text-[14px] font-bold text-[#ff7a59]">{calculateSalesInitiativeCredits(initiativeDraft)} CR</p>
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
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#516f90]">CSM</p>
                    <div className="mt-2 border-b border-dashed border-[#00bda5] pb-1 text-[12px] font-semibold text-[#33475b]">
                      {getAssigneeName(csmOptions, proposal.assignedCsmUserId) || "Sin asignar"}
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
      ) : null}

      <FeedbackToast feedback={feedback} onClose={() => setFeedback(null)} />
    </div>
  );
}
