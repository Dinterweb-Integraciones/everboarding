"use client";

import {
  AlertTriangle,
  CalendarDays,
  Copy,
  Download,
  FolderPen,
  Link2,
  Plus,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  PLAN_TIER_OPTIONS,
  RISK_INACTIVE_DAYS,
  STAGE_META,
  STATUS_META,
  UPSELL_PACK_CREDITS,
} from "@/lib/constants";
import {
  calculateCredits,
  calculateMetrics,
  calculateReductionPenalty,
  canEdit,
  createEmptyDraft,
  formatDateRange,
  getEstimatedStatus,
  getRoleLabel,
  suggestPlanPrice,
  type ClientProfileRole,
  type CustomPlanType,
  type InitiativeEditorDraft,
  type InitiativeRecord,
  type InitiativeStatus,
  type OnboardingSnapshot,
  type ProjectStage,
  type ShareLinkRecord,
} from "@/lib/onboarding";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate, formatUserError, safeParseNumber, toIsoDate } from "@/lib/utils";

type OnboardingClientPageProps = {
  initialData: OnboardingSnapshot;
  initialStage?: ProjectStage;
  userId: string;
};

const boardStatuses: InitiativeStatus[] = ["backlog", "planned", "executing", "completed"];
const summaryStatuses: InitiativeStatus[] = ["executing", "planned", "backlog", "completed"];

const stageToProfileRole: Record<ProjectStage, ClientProfileRole> = {
  sales: "sales",
  cs: "csm",
  client: "client",
};

const quickShareLabels: Record<ProjectStage, string> = {
  sales: "Copiar link para prospecto",
  cs: "Copiar link para CS",
  client: "Copiar link para cliente",
};

function isReservedStatus(status: InitiativeStatus) {
  return status === "planned" || status === "executing";
}

function getStatusDot(status: InitiativeStatus) {
  if (status === "executing") return "bg-emerald-500";
  if (status === "planned") return "bg-indigo-500";
  if (status === "completed") return "bg-slate-700";
  return "bg-slate-300";
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

export function OnboardingClientPage({
  initialData,
  initialStage = "cs",
  userId,
}: OnboardingClientPageProps) {
  const supabase = createSupabaseBrowserClient();
  const [client, setClient] = useState(initialData.client);
  const [config, setConfig] = useState(initialData.config);
  const [initiatives, setInitiatives] = useState(initialData.initiatives);
  const [shareLinks, setShareLinks] = useState(initialData.shareLinks);
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
  const [isGeneratingStageLink, setIsGeneratingStageLink] = useState<ProjectStage | null>(null);
  const [isOfferModalOpen, setIsOfferModalOpen] = useState(false);
  const [offerDraft, setOfferDraft] = useState<{
    credits: number;
    price: number;
    type: CustomPlanType;
    validityDays: number;
  }>({
    credits: config.custom_plan_credits ?? config.base_capacity,
    price: Number(config.custom_plan_price ?? suggestPlanPrice(config.base_capacity)),
    type: config.custom_plan_type ?? "mensual",
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

  const writable = canEdit(initialData.accessRole);
  const ownerCanShare = initialData.accessRole === "owner";
  const stageMeta = STAGE_META[activeStage];

  const metrics = useMemo(
    () => calculateMetrics(config, initiatives),
    [config, initiatives],
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

  const stagePlanPreview = useMemo(() => {
    return PLAN_TIER_OPTIONS.map((credits) => ({
      credits,
      price: suggestPlanPrice(credits),
      active: config.base_capacity === credits,
    }));
  }, [config.base_capacity]);

  const catalogOptions = useMemo(() => {
    const grouped = new Map<string, typeof initialData.catalog>();

    initialData.catalog.forEach((item) => {
      const items = grouped.get(item.category) ?? [];
      items.push(item);
      grouped.set(item.category, items);
    });

    return Array.from(grouped.entries());
  }, [initialData]);

  const cycleDaysRemaining = useMemo(() => getDaysUntil(metrics.cutoffDate), [metrics.cutoffDate]);
  const progressParts = useMemo(() => {
    const total = Math.max(metrics.total, 1);

    return {
      consumed: (metrics.consumed / total) * 100,
      reserved: (metrics.reserved / total) * 100,
      lost: (metrics.lost / total) * 100,
      available: (Math.max(metrics.available, 0) / total) * 100,
    };
  }, [metrics.available, metrics.consumed, metrics.lost, metrics.reserved, metrics.total]);

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

  function openOfferModal() {
    setOfferDraft({
      credits: config.custom_plan_credits ?? config.base_capacity,
      price: Number(config.custom_plan_price ?? suggestPlanPrice(config.base_capacity)),
      type: config.custom_plan_type ?? "mensual",
      validityDays: config.credit_validity_days,
    });
    setIsOfferModalOpen(true);
  }

  function applyOfferDraft() {
    setConfig((current) => ({
      ...current,
      base_capacity: Math.max(1, offerDraft.credits),
      custom_plan_credits: Math.max(1, offerDraft.credits),
      custom_plan_price: Math.max(0, offerDraft.price),
      custom_plan_type: offerDraft.type,
      credit_validity_days: Math.max(1, offerDraft.validityDays),
    }));
    setIsOfferModalOpen(false);
    showSuccess("Oferta configurada. Recuerda guardar los ajustes.");
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

  async function saveClientMeta() {
    setFeedback(null);
    setIsSavingMeta(true);

    const { data, error } = await supabase
      .from("clients")
      .update({
        name: client.name.trim(),
        description: client.description?.trim() || null,
      })
      .eq("id", client.id)
      .select("*")
      .single();

    setIsSavingMeta(false);

    if (error) {
      showError(error.message);
      return;
    }

    setClient((current) => ({ ...current, ...data }));
    showSuccess("Perfil del cliente guardado.");
  }

  async function saveConfig() {
    setFeedback(null);
    setIsSavingConfig(true);
    await persistConfig(config, "Configuracion del proyecto guardada.");
    setIsSavingConfig(false);
  }

  function copyCurrentViewLink() {
    const url = new URL(window.location.href);
    url.searchParams.set("stage", activeStage);
    navigator.clipboard.writeText(url.toString()).then(() => {
      showSuccess("Vista actual copiada.");
    });
  }

  function buildSharedUrl(link: ShareLinkRecord) {
    return `${window.location.origin}/shared/${link.token}?stage=${link.stage_scope}`;
  }

  async function copyStageShareLink(stage: ProjectStage) {
    if (!ownerCanShare) return;

    setFeedback(null);

    const existing = shareLinks.find(
      (link) =>
        !link.revoked_at &&
        link.stage_scope === stage &&
        link.access_role === "viewer" &&
        link.profile_role === stageToProfileRole[stage],
    );

    if (existing) {
      navigator.clipboard.writeText(buildSharedUrl(existing)).then(() => {
        showSuccess(`${quickShareLabels[stage]} listo.`);
      });
      return;
    }

    setIsGeneratingStageLink(stage);

    const { data, error } = await supabase
      .from("client_share_links")
      .insert({
        client_id: client.id,
        access_role: "viewer",
        profile_role: stageToProfileRole[stage],
        stage_scope: stage,
        created_by_user_id: userId,
      })
      .select("*")
      .single();

    setIsGeneratingStageLink(null);

    if (error) {
      showError(error.message);
      return;
    }

    setShareLinks((current) => [data, ...current]);
    navigator.clipboard.writeText(buildSharedUrl(data)).then(() => {
      showSuccess(`${quickShareLabels[stage]} listo.`);
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
        unitCredits: subitem.unit_credits,
        quantity: subitem.quantity,
      })),
      note: "",
    });
    setCatalogSelection("");
  }

  function updateDraftSubitem(
    index: number,
    field: "name" | "unitCredits" | "quantity",
    value: string,
  ) {
    if (!draft) return;

    const nextSubitems = [...draft.subitems];
    const target = nextSubitems[index];
    if (!target) return;

    if (field === "name") target.name = value;
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
        { catalogItemId: null, name: "Nueva actividad", unitCredits: 1, quantity: 1 },
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

  async function quickAddInitiative(status: InitiativeStatus) {
    const selectedCatalogId = quickAddSelections[status];
    const selectedItem = initialData.catalog.find((item) => item.id === selectedCatalogId);

    if (!selectedItem) {
      showError("Selecciona una actividad para anadirla.");
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

  async function moveInitiativeToStatus(initiative: InitiativeRecord, targetStatus: InitiativeStatus) {
    if (!writable || initiative.status === targetStatus) {
      setDraggedInitiativeId(null);
      setDropTargetStatus(null);
      return;
    }

    setFeedback(null);

    const currentReserved = isReservedStatus(initiative.status) ? initiative.credits : 0;
    const nextReserved = isReservedStatus(targetStatus) ? initiative.credits : 0;
    const capacityNeeded = nextReserved - currentReserved;

    if (capacityNeeded > metrics.available) {
      showError(`Capacidad insuficiente. Faltan ${capacityNeeded - metrics.available} creditos.`);
      setDraggedInitiativeId(null);
      setDropTargetStatus(null);
      return;
    }

    const penalty =
      initiative.status !== "completed" && initiative.status !== "backlog" && targetStatus === "backlog"
        ? Math.ceil(initiative.credits * 0.2)
        : 0;

    if (penalty > 0) {
      const confirmed = window.confirm(
        `Mover esta iniciativa a evaluacion aplicara una penalidad de ${penalty} creditos. Deseas continuar?`,
      );
      if (!confirmed) {
        setDraggedInitiativeId(null);
        setDropTargetStatus(null);
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
      const { data: updatedInitiative, error: updateError } = await supabase
        .from("onboarding_initiatives")
        .update({
          status: targetStatus,
          sort_order: groupedInitiatives[targetStatus].length,
          last_activity: nowDate,
          updated_by_user_id: userId,
        })
        .eq("id", initiative.id)
        .select("*")
        .single();

      if (updateError) {
        throw updateError;
      }

      const logMessages = [
        `Cambio a ${STATUS_META[targetStatus].label}.`,
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
      showSuccess(`Iniciativa movida a ${STATUS_META[targetStatus].label}.`);
    } catch (caughtError) {
      showError(
        caughtError instanceof Error ? caughtError.message : "No fue posible mover la iniciativa.",
      );
    } finally {
      setDraggedInitiativeId(null);
      setDropTargetStatus(null);
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
            }
          : initiative,
      ),
    );
    showSuccess("Iniciativa actualizada.");
    setDraft(null);
    setEditingInitiativeId(null);
  }

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

  async function exportPdf() {
    const target = document.getElementById("onboarding-export-root");
    if (!target) return;

    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import("html2canvas"),
      import("jspdf"),
    ]);

    const canvas = await html2canvas(target, { scale: 1.4, backgroundColor: "#f8fafc" });
    const imageData = canvas.toDataURL("image/png");
    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const width = pdf.internal.pageSize.getWidth();
    const height = pdf.internal.pageSize.getHeight();
    pdf.addImage(imageData, "PNG", 8, 8, width - 16, height - 16);
    pdf.save(`roadmap-${client.slug}.pdf`);
  }

  return (
    <div className="space-y-6" id="onboarding-export-root">
      <div className="overflow-hidden border-b border-[#dfe3eb] bg-white">
        <div className="border-b border-[#dfe3eb] px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#516f90]">
                Cliente
              </span>
              <span className="rounded-[3px] border border-[#cbd6e2] bg-[#f5f8fa] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[#516f90]">
                Vista {STAGE_META[activeStage].shortLabel}
              </span>
            </div>

            {ownerCanShare ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  className="rounded-[3px] border-[#cbd6e2] px-3 py-2 text-[11px] font-bold text-[#516f90]"
                  onClick={() => copyStageShareLink("client")}
                  disabled={isGeneratingStageLink === "client"}
                >
                  <Link2 className="mr-1.5 h-3.5 w-3.5" />
                  Copiar link para cliente
                </Button>
                <Button
                  variant="secondary"
                  className="rounded-[3px] border-[#cbd6e2] px-3 py-2 text-[11px] font-bold text-[#ff7a59]"
                  onClick={() => copyStageShareLink("sales")}
                  disabled={isGeneratingStageLink === "sales"}
                >
                  <Link2 className="mr-1.5 h-3.5 w-3.5" />
                  Copiar link para prospecto
                </Button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="bg-white px-6 py-4">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex min-h-11 min-w-[180px] max-w-[360px] items-center text-[28px] font-semibold tracking-[-0.02em] text-[#33475b]">
                  {client.name}
                </span>
                <div className="flex items-center gap-2 text-[11px] text-[#516f90]">
                  <CalendarDays className="h-3.5 w-3.5" />
                  <span>{formatLongDate(config.start_date)}</span>
                </div>
                <span className="rounded-[3px] bg-[#f5f8fa] px-2 py-1 text-[10px] font-bold text-[#516f90]">
                  {cycleDaysRemaining !== null
                    ? `${cycleDaysRemaining} d restantes del ciclo`
                    : "Sin ciclo activo"}
                </span>
                <Badge className="rounded-[3px] bg-[#f5f8fa] text-[#516f90]">
                  {getRoleLabel(initialData.accessRole)}
                </Badge>
                <Badge className="rounded-[3px] bg-[#eaf8f6] text-[#00bda5]">Proyecto unico</Badge>
              </div>

              <div className="mt-3 flex flex-wrap items-end gap-6 text-[11px] font-medium">
                <div className="flex items-baseline gap-1.5">
                  <span className="uppercase tracking-[0.14em] text-[#9cb1c6]">Disponibles</span>
                  <span className="text-[16px] font-bold text-[#00bda5]">{metrics.available} créditos</span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="uppercase tracking-[0.14em] text-[#9cb1c6]">Comprometidos</span>
                  <span className="text-[16px] font-bold text-[#6a78d1]">{metrics.reserved} créditos</span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="uppercase tracking-[0.14em] text-[#9cb1c6]">Completados</span>
                  <span className="text-[16px] font-bold text-[#33475b]">{metrics.consumed} créditos</span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="uppercase tracking-[0.14em] text-[#9cb1c6]">Aprovechamiento</span>
                  <span className="text-[16px] font-bold text-[#6a78d1]">
                    {metrics.total ? Math.round(((metrics.reserved + metrics.consumed) / metrics.total) * 100) : 0}%
                  </span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="uppercase tracking-[0.14em] text-[#9cb1c6]">Deducidos</span>
                  <span className="text-[16px] font-bold text-[#94a3b8]">{metrics.lost} créditos</span>
                </div>
              </div>

            </div>

            {writable ? (
              <div className="flex flex-wrap items-center justify-end gap-3 text-[11px] font-bold text-[#516f90]">
                <button
                  type="button"
                  onClick={() =>
                    setConfig((current) => ({
                      ...current,
                      base_capacity: 80,
                      extra_capacity: 0,
                      custom_plan_price: null,
                      custom_plan_type: null,
                    }))
                  }
                  className="transition hover:text-[#ef4444]"
                >
                  Limpiar
                </button>
                <div className="flex items-center gap-2">
                  <span>Plan:</span>
                  <Select
                    value={String(config.base_capacity)}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        base_capacity: safeParseNumber(event.target.value),
                      }))
                    }
                    className="h-9 min-w-[176px] rounded-[3px] border-[#cbd6e2] bg-transparent px-3 py-1 text-[11px] font-bold"
                  >
                    {PLAN_TIER_OPTIONS.map((plan) => (
                      <option key={plan} value={plan}>
                        {plan} créditos
                      </option>
                    ))}
                  </Select>
                </div>
                <button
                  type="button"
                  onClick={openOfferModal}
                  className="transition hover:text-[#33475b]"
                >
                  Configurar oferta
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setConfig((current) => ({
                      ...current,
                      extra_capacity: current.extra_capacity + 1,
                    }))
                  }
                  className="text-[#ff7a59] transition hover:text-[#dc6548]"
                >
                  Añadir +{UPSELL_PACK_CREDITS} créditos
                </button>
                <Button
                  className="rounded-[3px] bg-[#00bda5] px-3 py-2 text-[11px] font-bold text-white hover:bg-[#00a894]"
                  onClick={saveConfig}
                  disabled={isSavingConfig}
                >
                  {isSavingConfig ? "Guardando..." : "Guardar ajustes"}
                </Button>
                <Button
                  className="rounded-[3px] bg-[#33475b] px-3 py-2 text-[11px] font-bold text-white hover:bg-[#26394d]"
                  onClick={saveClientMeta}
                  disabled={isSavingMeta}
                >
                  {isSavingMeta ? "Guardando..." : "Guardar cliente"}
                </Button>
              </div>
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
              {stagePlanPreview.map((plan) => (
                <div
                  key={plan.credits}
                  className={`rounded-[4px] border px-3 py-3 text-center ${
                    plan.active ? "border-[#ff7a59] bg-[#fff3f0]" : "border-[#dfe3eb] bg-[#f5f8fa]"
                  }`}
                >
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#9cb1c6]">Plan</p>
                  <p className="mt-2 text-[18px] font-extrabold text-[#33475b]">{plan.credits} CR</p>
                  <p className="mt-1 text-[11px] text-[#516f90]">{formatCurrency(plan.price)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {feedback ? (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm ${
            feedback.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {feedback.message}
        </div>
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
                      setDropTargetStatus(status);
                    }}
                    onDragLeave={(event) => {
                      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                      setDropTargetStatus((current) => (current === status ? null : current));
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

                        return (
                          <button
                            key={initiative.id}
                            type="button"
                            onClick={() => openEditModal(initiative)}
                            draggable={writable}
                            onDragStart={(event) => {
                              if (!writable) return;
                              event.dataTransfer.setData("text/plain", initiative.id);
                              event.dataTransfer.effectAllowed = "move";
                              setDraggedInitiativeId(initiative.id);
                            }}
                            onDragEnd={() => {
                              setDraggedInitiativeId(null);
                              setDropTargetStatus(null);
                            }}
                            className="relative w-full rounded-[4px] border border-[#dfe3eb] bg-white p-3 text-left shadow-sm transition hover:border-[#cbd6e2] hover:shadow"
                          >
                            <div
                              className={`absolute left-0 top-0 h-full w-1 ${
                                status === "executing"
                                  ? "bg-[#00bda5]"
                                  : status === "planned"
                                    ? "bg-[#6a78d1]"
                                    : status === "completed"
                                      ? "bg-[#33475b]"
                                      : "bg-[#cbd6e2]"
                              }`}
                            />
                            <div className="pl-2">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <h4 className="text-[12px] font-bold text-[#33475b]">{initiative.title}</h4>
                                  <p className="mt-1 line-clamp-2 text-[10px] text-[#516f90]">
                                    {initiative.description || "Sin descripcion ejecutiva."}
                                  </p>
                                </div>
                                <span className="rounded-[2px] bg-[#eaf0f6] px-1.5 py-0.5 text-[9px] font-bold text-[#33475b]">
                                  {initiative.credits} CR
                                </span>
                              </div>

                              <div className="mt-3 space-y-1">
                                <div className="rounded-[2px] border border-[#f8c75c] bg-[#fff7dc] px-2 py-0.5 text-[9px] font-bold text-[#d97706]">
                                  {formatDateRange(
                                    initiative.est_start_date,
                                    initiative.est_end_date,
                                  )}
                                </div>
                                {initiative.is_blocked ? (
                                  <div className="text-[9px] font-bold uppercase text-[#ef4444]">Bloqueada</div>
                                ) : null}
                                {estimated ? (
                                  <div className="text-[9px] text-[#516f90]">{estimated.label}</div>
                                ) : null}
                                {initiative.status === "executing" && inactiveDays > RISK_INACTIVE_DAYS ? (
                                  <div className="text-[9px] font-bold text-[#ef4444]">
                                    {inactiveDays} d sin cambios
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </button>
                        );
                      })
                    ) : writable && status !== "completed" ? (
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
                            disabled={isSavingInitiative || !quickAddSelections[status]}
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
                    ) : (
                      <div className="rounded-[4px] border border-dashed border-[#cbd6e2] bg-white/70 p-4 text-[11px] text-[#9cb1c6]">
                        Vacio
                      </div>
                    )}
                  </div>

                  <div className="mt-3 flex gap-2">
                    {writable && (status === "backlog" || status === "planned" || status === "executing") ? (
                      <Button
                        variant="secondary"
                        className="w-full rounded-[3px] border-dashed border-[#cbd6e2] bg-white px-3 py-2 text-[10px] font-bold text-[#516f90]"
                        onClick={() => openCreateModal(status)}
                      >
                        <Plus className="mr-1.5 h-3.5 w-3.5" />
                        {status === "backlog"
                          ? "Anadir Caso de Uso a En evaluacion"
                          : status === "planned"
                            ? "Anadir Caso de Uso Directo"
                            : "Anadir iniciativa"}
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
        </div>
      </section>

      <section className="bg-white px-6 py-10">
        <div className="mx-auto max-w-[1050px]">
        <div className="flex flex-col gap-4 border-b border-[#dfe3eb] pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[18px] font-bold text-[#33475b]">
              <Sparkles className="h-4 w-4 text-[#00bda5]" />
              <span>Resumen de RoadMap</span>
            </div>
            <p className="mt-2 text-[12px] text-[#516f90]">
              Evolucion estrategica y resultados consolidados.
            </p>
          </div>
          <Button
            variant="secondary"
            className="rounded-[3px] border-[#cbd6e2] bg-[#f5f8fa] px-3 py-2 text-[11px] font-bold text-[#516f90]"
            onClick={exportPdf}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Exportar Reporte
          </Button>
        </div>

        <div className="relative mt-10">
          <div className="absolute left-0 right-0 top-5 hidden border-t border-[#dfe3eb] md:block" />
          <div className="grid gap-8 md:grid-cols-4">
          {summaryStatuses.map((status) => {
            const items = groupedInitiatives[status];
            const totalCredits = items.reduce((sum, initiative) => sum + initiative.credits, 0);
            const topItem = items[0];

            return (
              <div key={status} className="relative flex flex-col items-center text-center">
                <div
                  className={`relative z-10 grid h-7 w-7 place-items-center rounded-full border-4 border-white ${
                    status === "executing"
                      ? "bg-[#00bda5]"
                      : status === "planned"
                        ? "bg-[#6a78d1]"
                        : status === "completed"
                          ? "bg-[#33475b]"
                          : "bg-[#54779c]"
                  }`}
                />
                <h3 className="mt-4 text-[12px] font-bold uppercase tracking-[0.12em] text-[#33475b]">
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

                <div className="mt-4 min-h-[58px] w-full rounded-[4px] border border-dashed border-[#dfe3eb] bg-white p-2 text-left">
                  {topItem ? (
                    <button type="button" className="w-full text-left" onClick={() => openEditModal(topItem)}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[11px] font-bold text-[#33475b]">{topItem.title}</p>
                          <p className="mt-1 line-clamp-2 text-[10px] text-[#516f90]">
                            {topItem.description || "Sin descripcion ejecutiva."}
                          </p>
                        </div>
                        <span className="rounded-[2px] bg-[#eaf0f6] px-1.5 py-0.5 text-[9px] font-bold text-[#33475b]">
                          {topItem.credits} CR
                        </span>
                      </div>
                    </button>
                  ) : (
                    <p className="pt-2 text-center text-[10px] text-[#9cb1c6]">Vacio</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
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
                            <div className="mt-2 rounded-[2px] border border-[#f8c75c] bg-[#fff7dc] px-2 py-0.5 text-[9px] font-bold text-[#d97706]">
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

      {isOfferModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6 backdrop-blur-sm">
          <Card className="w-full max-w-2xl rounded-[24px] border border-slate-200 bg-white p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Configurar oferta
                </p>
                <h3 className="mt-2 text-2xl font-semibold text-slate-950">
                  Ajusta creditos, precio y vigencia del onboarding.
                </h3>
              </div>
              <Button variant="ghost" onClick={() => setIsOfferModalOpen(false)}>
                Cerrar
              </Button>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-700">Creditos del plan</span>
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
                <span className="text-sm font-medium text-slate-700">Precio sugerido</span>
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
                <span className="text-sm font-medium text-slate-700">Tipo de oferta</span>
                <Select
                  value={offerDraft.type}
                  onChange={(event) =>
                    setOfferDraft((current) => ({
                      ...current,
                      type: event.target.value as CustomPlanType,
                    }))
                  }
                >
                  <option value="mensual">Mensual</option>
                  <option value="proyecto">Proyecto</option>
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
                Plan propuesto: <strong>{offerDraft.credits} CR</strong> ·{" "}
                <strong>{formatCurrency(offerDraft.price)}</strong> · vigencia de{" "}
                <strong>{offerDraft.validityDays} dias</strong>.
              </p>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <Button onClick={applyOfferDraft}>Aplicar oferta</Button>
              <Button variant="secondary" onClick={() => setOfferDraft((current) => ({
                ...current,
                price: suggestPlanPrice(current.credits),
              }))}>
                Recalcular precio
              </Button>
              <Button variant="ghost" onClick={() => setIsOfferModalOpen(false)}>
                Cancelar
              </Button>
            </div>
          </Card>
        </div>
      ) : null}

      {draft ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6 backdrop-blur-sm">
          <Card className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-[28px] border border-slate-200 bg-white p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
                  {editingInitiativeId ? "Editar iniciativa" : "Nueva iniciativa"}
                </p>
                <h3 className="mt-2 text-2xl font-semibold text-slate-950">
                  Gestiona alcance, fechas, actividades y notas operativas.
                </h3>
              </div>
              <Button variant="ghost" onClick={() => setDraft(null)}>
                Cerrar
              </Button>
            </div>
            <div className="mt-6 grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
              <div className="space-y-4">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-slate-700">Titulo</span>
                  <Input
                    value={draft.title}
                    onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                    disabled={!writable}
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-slate-700">Categoria</span>
                  <Input
                    value={draft.type}
                    onChange={(event) => setDraft({ ...draft, type: event.target.value })}
                    disabled={!writable}
                  />
                </label>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-slate-700">Estado</span>
                    <Select
                      value={draft.status}
                      onChange={(event) =>
                        setDraft({ ...draft, status: event.target.value as InitiativeStatus })
                      }
                      disabled={!writable}
                    >
                      {boardStatuses.map((status) => (
                        <option key={status} value={status}>
                          {STATUS_META[status].label}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label className="flex items-end gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={draft.isBlocked}
                      onChange={(event) => setDraft({ ...draft, isBlocked: event.target.checked })}
                      disabled={!writable}
                    />
                    <div>
                      <p className="text-sm font-medium text-slate-800">Bloqueada</p>
                      <p className="text-xs text-slate-500">Marca dependencias o aprobaciones pendientes.</p>
                    </div>
                  </label>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-slate-700">Fecha estimada inicio</span>
                    <Input
                      type="date"
                      value={draft.estStartDate}
                      onChange={(event) => setDraft({ ...draft, estStartDate: event.target.value })}
                      disabled={!writable}
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-slate-700">Fecha estimada fin</span>
                    <Input
                      type="date"
                      value={draft.estEndDate}
                      onChange={(event) => setDraft({ ...draft, estEndDate: event.target.value })}
                      disabled={!writable}
                    />
                  </label>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-slate-700">Responsable cliente</span>
                    <Input
                      value={draft.ownerClient}
                      onChange={(event) => setDraft({ ...draft, ownerClient: event.target.value })}
                      disabled={!writable}
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-slate-700">Responsable CSM</span>
                    <Input
                      value={draft.ownerCSM}
                      onChange={(event) => setDraft({ ...draft, ownerCSM: event.target.value })}
                      disabled={!writable}
                    />
                  </label>
                </div>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-slate-700">Descripcion</span>
                  <Textarea
                    rows={5}
                    value={draft.description}
                    onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                    disabled={!writable}
                  />
                </label>
              </div>

              <div className="space-y-4">
                <Card className="rounded-[24px] border border-slate-200 bg-slate-50 p-4 shadow-none">
                  <div className="flex items-center justify-between gap-3">
                    <h4 className="text-lg font-semibold text-slate-900">Actividades incluidas</h4>
                    <Badge className="bg-white text-slate-700">
                      {calculateCredits(
                        draft.subitems.map((subitem) => ({
                          unit_credits: subitem.unitCredits,
                          quantity: subitem.quantity,
                        })),
                      )}{" "}
                      CR
                    </Badge>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <Select
                      value={catalogSelection}
                      onChange={(event) => setCatalogSelection(event.target.value)}
                      disabled={!writable}
                    >
                      <option value="">Selecciona desde catalogo</option>
                      {initialData.catalog.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.category} - {item.label} ({item.credits} CR)
                        </option>
                      ))}
                    </Select>
                    <Button variant="secondary" onClick={addCatalogItem} disabled={!writable}>
                      Agregar
                    </Button>
                  </div>
                  <div className="mt-3">
                    <Button variant="ghost" onClick={addManualSubitem} disabled={!writable}>
                      <Plus className="mr-2 h-4 w-4" />
                      Actividad personalizada
                    </Button>
                  </div>
                  <div className="mt-4 space-y-3">
                    {draft.subitems.map((subitem, index) => (
                      <div key={`${subitem.name}-${index}`} className="rounded-2xl border border-slate-200 bg-white p-3">
                        <div className="grid gap-3 md:grid-cols-[1fr_120px_110px_auto]">
                          <Input
                            value={subitem.name}
                            onChange={(event) => updateDraftSubitem(index, "name", event.target.value)}
                            disabled={!writable}
                          />
                          <Input
                            type="number"
                            min={0}
                            value={subitem.unitCredits}
                            onChange={(event) => updateDraftSubitem(index, "unitCredits", event.target.value)}
                            disabled={!writable}
                          />
                          <Input
                            type="number"
                            min={1}
                            value={subitem.quantity}
                            onChange={(event) => updateDraftSubitem(index, "quantity", event.target.value)}
                            disabled={!writable}
                          />
                          <Button variant="danger" onClick={() => removeDraftSubitem(index)} disabled={!writable}>
                            Quitar
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>

                <Card className="rounded-[24px] border border-slate-200 bg-slate-50 p-4 shadow-none">
                  <h4 className="text-lg font-semibold text-slate-900">Historial y notas</h4>
                  <Textarea
                    rows={3}
                    className="mt-4"
                    placeholder="Escribe una nota operativa para guardar junto con este cambio."
                    value={draft.note}
                    onChange={(event) => setDraft({ ...draft, note: event.target.value })}
                    disabled={!writable}
                  />
                  {editingInitiativeId ? (
                    <div className="mt-4 space-y-2">
                      {initiatives
                        .find((initiative) => initiative.id === editingInitiativeId)
                        ?.logs.map((log) => (
                          <div key={log.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                            <p className="text-xs text-slate-500">{formatDate(log.created_at)}</p>
                            <p className="mt-1 text-sm text-slate-700">{log.entry}</p>
                          </div>
                        ))}
                    </div>
                  ) : null}
                </Card>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3 border-t border-slate-100 pt-6">
              {writable ? (
                <Button onClick={saveInitiative} disabled={isSavingInitiative}>
                  <FolderPen className="mr-2 h-4 w-4" />
                  {isSavingInitiative ? "Guardando..." : "Guardar iniciativa"}
                </Button>
              ) : null}
              {editingInitiativeId && writable ? (
                <Button
                  variant="danger"
                  onClick={() => {
                    const initiative = initiatives.find((item) => item.id === editingInitiativeId);
                    if (initiative) void deleteInitiative(initiative);
                  }}
                >
                  Eliminar iniciativa
                </Button>
              ) : null}
              <Button variant="secondary" onClick={() => setDraft(null)}>
                Cerrar
              </Button>
              {!writable ? (
                <div className="ml-auto flex items-center gap-2 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
                  <AlertTriangle className="h-4 w-4" />
                  Este onboarding esta en modo solo lectura.
                </div>
              ) : null}
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
