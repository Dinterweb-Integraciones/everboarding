"use client";

import { ChevronDown, ChevronLeft, ChevronRight, Eye, Layers3, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { Fragment, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { FeedbackToast } from "@/components/ui/feedback-toast";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type {
  CreditCatalogGroup,
  CreditCatalogGroupCategory,
  CreditCatalogGroupCategoryLink,
  CreditCatalogGroupItem,
  CreditCatalogItem,
} from "@/lib/onboarding";
import { formatUserError, safeParseNumber } from "@/lib/utils";

type CatalogGroupsManagerProps = {
  initialGroups: CreditCatalogGroup[];
  initialGroupCategories: CreditCatalogGroupCategory[];
  initialGroupCategoryLinks: CreditCatalogGroupCategoryLink[];
  initialItems: CreditCatalogItem[];
  initialMemberships: CreditCatalogGroupItem[];
};

type CatalogGroupForm = {
  name: string;
  description: string;
  modalCategoryIds: string[];
  priorityStatus: "normal" | "prioritario";
  credits: string;
  sortOrder: string;
  isActive: boolean;
};

const emptyForm: CatalogGroupForm = {
  name: "",
  description: "",
  modalCategoryIds: [],
  priorityStatus: "normal",
  credits: "0",
  sortOrder: "0",
  isActive: true,
};

export function CatalogGroupsManager({
  initialGroups,
  initialGroupCategories,
  initialGroupCategoryLinks,
  initialItems,
  initialMemberships,
}: CatalogGroupsManagerProps) {
  const [groups, setGroups] = useState(initialGroups);
  const [groupCategories] = useState(initialGroupCategories);
  const [groupCategoryLinks, setGroupCategoryLinks] = useState(initialGroupCategoryLinks);
  const [items] = useState(initialItems);
  const [memberships, setMemberships] = useState(initialMemberships);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CatalogGroupForm>(emptyForm);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [taskToAdd, setTaskToAdd] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isCategoryMenuOpen, setIsCategoryMenuOpen] = useState(false);
  const [groupSearchQuery, setGroupSearchQuery] = useState("");
  const [groupsPageSize, setGroupsPageSize] = useState(10);
  const [currentGroupsPage, setCurrentGroupsPage] = useState(1);
  const [openDescriptionGroupId, setOpenDescriptionGroupId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const deferredGroupSearchQuery = useDeferredValue(groupSearchQuery);
  const categoryMenuRef = useRef<HTMLDivElement | null>(null);

  const groupCategoriesById = useMemo(
    () => new Map(groupCategories.map((category) => [category.id, category])),
    [groupCategories],
  );

  const availableGroupCategories = useMemo(
    () =>
      [...groupCategories].sort(
        (left, right) =>
          safeParseNumber(left.sort_order) - safeParseNumber(right.sort_order)
          || left.name.localeCompare(right.name, "es"),
      ),
    [groupCategories],
  );

  const selectedCategorySummary = useMemo(() => {
    if (!form.modalCategoryIds.length) {
      return "Selecciona una o varias categorias";
    }

    const selectedNames = form.modalCategoryIds
      .map((categoryId) => groupCategoriesById.get(categoryId)?.name ?? null)
      .filter((categoryName): categoryName is string => Boolean(categoryName));

    if (!selectedNames.length) {
      return "Selecciona una o varias categorias";
    }

    if (selectedNames.length <= 2) {
      return selectedNames.join(", ");
    }

    return `${selectedNames.slice(0, 2).join(", ")} +${selectedNames.length - 2}`;
  }, [form.modalCategoryIds, groupCategoriesById]);

  const sortedItems = useMemo(
    () =>
      [...items].sort(
        (left, right) =>
          left.category.localeCompare(right.category) ||
          safeParseNumber(left.sort_order) - safeParseNumber(right.sort_order) ||
          left.label.localeCompare(right.label),
      ),
    [items],
  );

  const visibleGroups = useMemo(() => {
    const membershipsByGroup = new Map<string, CreditCatalogGroupItem[]>();

    for (const membership of memberships) {
      const current = membershipsByGroup.get(membership.group_id) ?? [];
      current.push(membership);
      membershipsByGroup.set(membership.group_id, current);
    }

    return groups.filter((group) => {
      const groupMemberships = membershipsByGroup.get(group.id) ?? [];
      if (!groupMemberships.length) {
        return true;
      }

      const taskRows = groupMemberships
        .map((membership) => items.find((item) => item.id === membership.catalog_item_id))
        .filter((item): item is CreditCatalogItem => Boolean(item));

      const allTasksMatchCategory = taskRows.length > 0 && taskRows.every((item) => item.category === group.name);
      const sameCountAsCategory = taskRows.length > 0
        && taskRows.length === items.filter((item) => item.category === group.name).length;

      const looksLikeLegacyMirror =
        !group.created_by_user_id &&
        !group.description &&
        safeParseNumber(group.credits) === 0 &&
        allTasksMatchCategory &&
        sameCountAsCategory;

      return !looksLikeLegacyMirror;
    });
  }, [groups, items, memberships]);

  const sortedGroups = useMemo(
    () =>
      [...visibleGroups].sort(
        (left, right) =>
          safeParseNumber(left.sort_order) - safeParseNumber(right.sort_order) ||
          left.name.localeCompare(right.name),
      ),
    [visibleGroups],
  );

  const groupedOptions = useMemo(() => {
    const map = new Map<string, CreditCatalogItem[]>();
    for (const item of sortedItems.filter((currentItem) => currentItem.is_active)) {
      const current = map.get(item.category) ?? [];
      current.push(item);
      map.set(item.category, current);
    }
    return [...map.entries()];
  }, [sortedItems]);

  const selectedTasks = useMemo(
    () =>
      selectedTaskIds
        .map((taskId) => items.find((item) => item.id === taskId))
        .filter((item): item is CreditCatalogItem => Boolean(item)),
    [items, selectedTaskIds],
  );

  const selectedTasksCredits = useMemo(
    () => selectedTasks.reduce((sum, task) => sum + safeParseNumber(task.credits), 0),
    [selectedTasks],
  );

  const availableTasks = useMemo(
    () => sortedItems.filter((item) => !selectedTaskIds.includes(item.id) && item.is_active),
    [selectedTaskIds, sortedItems],
  );

  const groupsTableRows = useMemo(
    () =>
      sortedGroups.map((group) => {
        const selectedCategoryIds = groupCategoryLinks
          .filter((link) => link.group_id === group.id)
          .map((link) => link.category_id);
        const uniqueSelectedCategoryIds = [...new Set(selectedCategoryIds)];
        const taskIds = memberships
          .filter((membership) => membership.group_id === group.id)
          .sort((left, right) => safeParseNumber(left.sort_order) - safeParseNumber(right.sort_order))
          .map((membership) => membership.catalog_item_id);

        const groupTasks = taskIds
          .map((taskId) => items.find((item) => item.id === taskId))
          .filter((item): item is CreditCatalogItem => Boolean(item));

        return {
          ...group,
          modalCategoryIds: uniqueSelectedCategoryIds.length
            ? uniqueSelectedCategoryIds
            : group.modal_category_id
              ? [group.modal_category_id]
              : [],
          modalCategoryNames: uniqueSelectedCategoryIds.length
            ? uniqueSelectedCategoryIds
              .map((categoryId) => groupCategoriesById.get(categoryId)?.name ?? null)
              .filter((categoryName): categoryName is string => Boolean(categoryName))
            : group.modal_category_id
              ? [groupCategoriesById.get(group.modal_category_id)?.name ?? group.modal_category ?? ""].filter(Boolean)
              : (group.modal_category ? [group.modal_category] : []),
          priorityStatus: group.priority_status === "prioritario" ? "prioritario" : "normal",
          taskCount: groupTasks.length,
          totalCredits: groupTasks.length
            ? groupTasks.reduce((sum, item) => sum + safeParseNumber(item.credits), 0)
            : safeParseNumber(group.credits),
          taskNames: groupTasks.map((item) => item.label),
          taskCategories: [...new Set(groupTasks.map((item) => item.category))],
        };
      }),
    [groupCategoriesById, groupCategoryLinks, items, memberships, sortedGroups],
  );

  const filteredGroupsTableRows = useMemo(() => {
    const normalizedQuery = deferredGroupSearchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return groupsTableRows;
    }

    return groupsTableRows.filter((group) =>
      [
        group.name,
        group.description ?? "",
        group.modalCategoryNames.join(" "),
        group.priorityStatus,
        group.priorityStatus === "prioritario" ? "prioritario" : "normal",
        group.is_active ? "activo" : "inactivo",
        `${group.totalCredits} cr`,
        `${group.taskCount} tareas`,
        group.taskNames.join(" "),
        group.taskCategories.join(" "),
      ].some((value) => value.toLowerCase().includes(normalizedQuery)),
    );
  }, [deferredGroupSearchQuery, groupsTableRows]);

  const totalGroupsPages = Math.max(1, Math.ceil(filteredGroupsTableRows.length / groupsPageSize));
  const visibleGroupsPage = Math.min(currentGroupsPage, totalGroupsPages);

  useEffect(() => {
    setCurrentGroupsPage((currentPage) => Math.min(currentPage, totalGroupsPages));
  }, [totalGroupsPages]);

  useEffect(() => {
    if (!isCategoryMenuOpen) {
      return undefined;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!categoryMenuRef.current?.contains(event.target as Node)) {
        setIsCategoryMenuOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsCategoryMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isCategoryMenuOpen]);

  const paginatedGroupsTableRows = useMemo(() => {
    const startIndex = (visibleGroupsPage - 1) * groupsPageSize;
    return filteredGroupsTableRows.slice(startIndex, startIndex + groupsPageSize);
  }, [filteredGroupsTableRows, groupsPageSize, visibleGroupsPage]);

  const visibleGroupsStart = filteredGroupsTableRows.length
    ? (visibleGroupsPage - 1) * groupsPageSize + 1
    : 0;
  const visibleGroupsEnd = filteredGroupsTableRows.length
    ? Math.min(visibleGroupsPage * groupsPageSize, filteredGroupsTableRows.length)
    : 0;

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
    setSelectedTaskIds([]);
    setTaskToAdd("");
    setIsCategoryMenuOpen(false);
  }

  function startEdit(group: CreditCatalogGroup) {
    const selectedCategoryIds = groupCategoryLinks
      .filter((link) => link.group_id === group.id)
      .map((link) => link.category_id)
      .filter((categoryId, index, current) => current.indexOf(categoryId) === index);

    setEditingId(group.id);
    setForm({
      name: group.name,
      description: group.description ?? "",
      modalCategoryIds: selectedCategoryIds.length
        ? selectedCategoryIds
        : group.modal_category_id
          ? [group.modal_category_id]
          : [],
      priorityStatus: group.priority_status === "prioritario" ? "prioritario" : "normal",
      credits: String(group.credits ?? 0),
      sortOrder: String(group.sort_order ?? 0),
      isActive: group.is_active,
    });
    setSelectedTaskIds(
      memberships
        .filter((membership) => membership.group_id === group.id)
        .sort((left, right) => safeParseNumber(left.sort_order) - safeParseNumber(right.sort_order))
        .map((membership) => membership.catalog_item_id),
    );
    setTaskToAdd("");
    setIsCategoryMenuOpen(false);
  }

  function attachTaskToDraft() {
    if (!taskToAdd || selectedTaskIds.includes(taskToAdd)) return;
    setSelectedTaskIds((current) => [...current, taskToAdd]);
    setTaskToAdd("");
  }

  function detachTaskFromDraft(taskId: string) {
    setSelectedTaskIds((current) => current.filter((currentId) => currentId !== taskId));
  }

  function toggleModalCategory(categoryId: string) {
    setForm((current) => ({
      ...current,
      modalCategoryIds: current.modalCategoryIds.includes(categoryId)
        ? current.modalCategoryIds.filter((currentId) => currentId !== categoryId)
        : [...current.modalCategoryIds, categoryId],
    }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setFeedback(null);

    const manualCredits = Math.max(0, safeParseNumber(form.credits));

    if (!selectedTaskIds.length && manualCredits <= 0) {
      setFeedback({
        tone: "error",
        message: "Agrega tareas al grupo o define una cantidad de creditos mayor a cero.",
      });
      setIsSaving(false);
      return;
    }

    try {
      const response = await fetch(
        editingId ? `/api/cs/catalog-groups/${editingId}` : "/api/cs/catalog-groups",
        {
          method: editingId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name,
            description: form.description,
            modalCategoryIds: form.modalCategoryIds,
            priorityStatus: form.priorityStatus,
            credits: manualCredits,
            sortOrder: safeParseNumber(form.sortOrder),
            isActive: form.isActive,
            taskIds: selectedTaskIds,
          }),
        },
      );

      const payload = (await response.json()) as CreditCatalogGroup & { message?: string };
      if (!response.ok) {
        throw new Error(payload.message || "No pudimos guardar el grupo.");
      }

      const nextMemberships = selectedTaskIds.map((taskId, index) => ({
        id: crypto.randomUUID(),
        group_id: payload.id,
        catalog_item_id: taskId,
        sort_order: index,
        created_at: new Date().toISOString(),
      })) satisfies CreditCatalogGroupItem[];
      const nextCategoryLinks = form.modalCategoryIds.map((categoryId) => ({
        id: crypto.randomUUID(),
        group_id: payload.id,
        category_id: categoryId,
        created_at: new Date().toISOString(),
      })) satisfies CreditCatalogGroupCategoryLink[];

      if (editingId) {
        setGroups((current) =>
          current.map((group) => (group.id === editingId ? { ...group, ...payload } : group)),
        );
        setGroupCategoryLinks((current) => [
          ...current.filter((link) => link.group_id !== editingId),
          ...nextCategoryLinks,
        ]);
        setMemberships((current) => [
          ...current.filter((membership) => membership.group_id !== editingId),
          ...nextMemberships,
        ]);
        setFeedback({ tone: "success", message: "Grupo actualizado." });
      } else {
        setGroups((current) => [...current, payload]);
        setGroupCategoryLinks((current) => [...current, ...nextCategoryLinks]);
        setMemberships((current) => [...current, ...nextMemberships]);
        setFeedback({ tone: "success", message: "Grupo creado." });
      }

      resetForm();
    } catch (caughtError) {
      setFeedback({
        tone: "error",
        message: formatUserError(caughtError, "No pudimos guardar el grupo."),
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(group: CreditCatalogGroup) {
    const confirmed = window.confirm(
      `Eliminar "${group.name}" quitara solamente el grupo, pero no borrara las tareas. Deseas continuar?`,
    );
    if (!confirmed) return;

    setFeedback(null);

    try {
      const response = await fetch(`/api/cs/catalog-groups/${group.id}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message || "No pudimos eliminar el grupo.");
      }

      setGroups((current) => current.filter((item) => item.id !== group.id));
      setGroupCategoryLinks((current) => current.filter((link) => link.group_id !== group.id));
      setMemberships((current) => current.filter((membership) => membership.group_id !== group.id));
      if (editingId === group.id) {
        resetForm();
      }
      if (openDescriptionGroupId === group.id) {
        setOpenDescriptionGroupId(null);
      }
      setFeedback({ tone: "success", message: "Grupo eliminado." });
    } catch (caughtError) {
      setFeedback({
        tone: "error",
        message: formatUserError(caughtError, "No pudimos eliminar el grupo."),
      });
    }
  }

  return (
    <>
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <section className="rounded-[18px] border border-slate-200 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.05)]">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-[var(--accent)]">
              <Layers3 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                CRUD CS
              </p>
              <h1 className="text-2xl font-black text-slate-900">Gestion de grupos / casos de uso</h1>
            </div>
          </div>

          <p className="mt-4 text-sm text-slate-600">
            Administra grupos de tareas o casos de uso con creditos manuales.
          </p>

          <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px_220px]">
              <div>
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Nombre del grupo
                </label>
                <Input
                  value={form.name ?? ""}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, name: event.target.value }))
                  }
                  placeholder="Kickoff de implementacion"
                />
              </div>

              <div>
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Creditos manuales
                </label>
                <Input
                  type="number"
                  min={0}
                  value={form.credits ?? "0"}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, credits: event.target.value }))
                  }
                />
                <p className="mt-2 text-xs text-slate-500">
                  Usalos cuando el grupo no lleve tareas. Si agregas tareas, el total se calcula con ellas.
                </p>
              </div>

              <div>
                <label className="flex items-center gap-3 rounded-[12px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 sm:mt-7">
                  <input
                    type="checkbox"
                    checked={Boolean(form.isActive)}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, isActive: event.target.checked }))
                    }
                    className="h-4 w-4 rounded border-slate-300 text-[var(--accent)] focus:ring-[var(--accent)]"
                  />
                  Grupo activo
                </label>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Categoria visible en guía inteligente
                </label>
                <div ref={categoryMenuRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setIsCategoryMenuOpen((current) => !current)}
                    className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-sm leading-5 text-slate-900 shadow-sm outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--accent)_20%,white)]"
                  >
                    <span className={form.modalCategoryIds.length ? "text-slate-900" : "text-slate-400"}>
                      {selectedCategorySummary}
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 text-slate-400 transition ${isCategoryMenuOpen ? "rotate-180" : ""}`}
                    />
                  </button>

                  {isCategoryMenuOpen ? (
                    <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-20 overflow-hidden rounded-[16px] border border-slate-200 bg-white shadow-[0_18px_45px_rgba(15,23,42,0.12)]">
                      <div className="max-h-72 overflow-y-auto p-2">
                        {availableGroupCategories.length ? (
                          availableGroupCategories.map((category) => {
                            const selected = form.modalCategoryIds.includes(category.id);

                            return (
                              <button
                                key={category.id}
                                type="button"
                                onClick={() => toggleModalCategory(category.id)}
                                className={`flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-left text-sm transition ${
                                  selected
                                    ? "bg-[color-mix(in_oklab,var(--accent)_10%,white)] text-slate-900"
                                    : "text-slate-700 hover:bg-slate-50"
                                }`}
                              >
                                <span
                                  className={`flex h-4 w-4 items-center justify-center rounded border text-[11px] ${
                                    selected
                                      ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                                      : "border-slate-300 bg-white text-transparent"
                                  }`}
                                >
                                  ✓
                                </span>
                                <span>{category.name}</span>
                              </button>
                            );
                          })
                        ) : (
                          <div className="rounded-[12px] px-3 py-4 text-sm text-slate-500">
                            No hay categorias disponibles todavia.
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {form.modalCategoryIds.length ? (
                    form.modalCategoryIds.map((categoryId) => (
                      <span
                        key={categoryId}
                        className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700"
                      >
                        {groupCategoriesById.get(categoryId)?.name ?? categoryId}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-slate-400">Sin categorias asignadas.</span>
                  )}
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Esta categoria define en qué pestaña del modal comercial aparecerá el grupo.
                </p>
              </div>

              <div>
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Estado de prioridad
                </label>
                <Select
                  value={form.priorityStatus}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      priorityStatus: event.target.value === "prioritario" ? "prioritario" : "normal",
                    }))
                  }
                >
                  <option value="normal">Normal</option>
                  <option value="prioritario">Prioritario</option>
                </Select>
                <p className="mt-2 text-xs text-slate-500">
                  Los grupos prioritarios aparecen primero en su categoría dentro del modal comercial.
                </p>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                Descripcion
              </label>
              <Textarea
                rows={3}
                value={form.description ?? ""}
                onChange={(event) =>
                  setForm((current) => ({ ...current, description: event.target.value }))
                }
                placeholder="Describe para que sirve este caso de uso o conglomerado de tareas."
              />
            </div>

            <div className="rounded-[14px] border border-slate-200 bg-slate-50 p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-dashed border-slate-200 bg-white px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Composicion del grupo</p>
                  <p className="text-xs text-slate-500">
                    Puedes dejar el grupo sin tareas y asignarle creditos manuales.
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs uppercase tracking-[0.14em] text-slate-400">
                    Total actual
                  </p>
                  <p className="text-lg font-black text-slate-900">
                    {selectedTaskIds.length ? selectedTasksCredits : Math.max(0, safeParseNumber(form.credits))} CR
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[280px] flex-1">
                  <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                    Agregar tarea al grupo
                  </label>
                  <Select value={taskToAdd} onChange={(event) => setTaskToAdd(event.target.value)}>
                    <option value="">Selecciona una tarea</option>
                    {groupedOptions.map(([category, categoryItems]) => {
                      const visibleItems = categoryItems.filter((item) =>
                        availableTasks.some((availableTask) => availableTask.id === item.id),
                      );

                      if (!visibleItems.length) {
                        return null;
                      }

                      return (
                        <optgroup key={category} label={category}>
                          {visibleItems.map((task) => (
                            <option key={task.id} value={task.id}>
                              {task.label} ({task.credits} CR)
                            </option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </Select>
                </div>
                <Button type="button" variant="secondary" onClick={attachTaskToDraft}>
                  <Plus className="mr-2 h-4 w-4" />
                  Agregar tarea
                </Button>
              </div>

              <div className="mt-4 overflow-hidden rounded-[12px] border border-slate-200 bg-white">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                        Tarea
                      </th>
                      <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                        Categoria
                      </th>
                      <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                        Creditos
                      </th>
                      <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                        Accion
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedTasks.length ? (
                      selectedTasks.map((task) => (
                        <tr key={task.id}>
                          <td className="px-4 py-3 font-semibold text-slate-900">{task.label}</td>
                          <td className="px-4 py-3 text-slate-600">{task.category}</td>
                          <td className="px-4 py-3 text-slate-600">{task.credits} CR</td>
                          <td className="px-4 py-3 text-right">
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => detachTaskFromDraft(task.id)}
                            >
                              <X className="mr-2 h-4 w-4" />
                              Quitar
                            </Button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                          Este grupo aun no tiene tareas asociadas.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={isSaving}>
                <Plus className="mr-2 h-4 w-4" />
                {isSaving ? "Guardando..." : editingId ? "Actualizar grupo" : "Crear grupo"}
              </Button>
              <Button type="button" variant="secondary" onClick={resetForm} disabled={isSaving}>
                Limpiar
              </Button>
            </div>
          </form>
        </section>

        <section className="mt-6 rounded-[18px] border border-slate-200 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.05)]">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                Tabla CRUD
              </p>
              <h2 className="mt-1 text-xl font-black text-slate-900">Grupos registrados</h2>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
              {filteredGroupsTableRows.length === groupsTableRows.length
                ? `${groupsTableRows.length} grupos`
                : `${filteredGroupsTableRows.length} de ${groupsTableRows.length} grupos`}
            </span>
          </div>

          <div className="mt-5 rounded-[14px] border border-slate-200 bg-slate-50/70 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="relative w-full max-w-xl">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={groupSearchQuery}
                  onChange={(event) => {
                    setGroupSearchQuery(event.target.value);
                    setCurrentGroupsPage(1);
                  }}
                  placeholder="Buscar por grupo, descripcion, categoria, tarea o estado"
                  className="pl-9"
                />
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
                <p className="text-sm text-slate-500">
                  Mostrando {visibleGroupsStart}-{visibleGroupsEnd} de {filteredGroupsTableRows.length}
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                    Filas
                  </span>
                  <Select
                    value={String(groupsPageSize)}
                    onChange={(event) => {
                      setGroupsPageSize(Number(event.target.value));
                      setCurrentGroupsPage(1);
                    }}
                    className="w-[88px] bg-white"
                  >
                    <option value="5">5</option>
                    <option value="10">10</option>
                    <option value="20">20</option>
                    <option value="50">50</option>
                  </Select>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-[14px] border border-slate-200">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                      Grupo
                    </th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                      Creditos
                    </th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                      Categorias visibles
                    </th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                      Prioridad
                    </th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                      Estado
                    </th>
                    <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {paginatedGroupsTableRows.length ? (
                    paginatedGroupsTableRows.map((group) => (
                      <Fragment key={group.id}>
                        <tr>
                          <td className="px-4 py-4">
                            <div className="font-semibold text-slate-900">{group.name}</div>
                            <div className="text-xs text-slate-500">{group.taskCount} tareas</div>
                          </td>
                          <td className="px-4 py-4 text-slate-600">{group.totalCredits} CR</td>
                          <td className="px-4 py-4 text-slate-600">
                            <div className="flex flex-wrap gap-2">
                              {group.modalCategoryNames.length ? (
                                group.modalCategoryNames.map((categoryName) => (
                                  <span
                                    key={`${group.id}-${categoryName}`}
                                    className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700"
                                  >
                                    {categoryName}
                                  </span>
                                ))
                              ) : (
                                <span>Sin categoria</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <span
                              className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                                group.priorityStatus === "prioritario"
                                  ? "bg-amber-50 text-amber-700"
                                  : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {group.priorityStatus === "prioritario" ? "Prioritario" : "Normal"}
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            <span
                              className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                                group.is_active
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-slate-200 text-slate-600"
                              }`}
                            >
                              {group.is_active ? "Activo" : "Inactivo"}
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex justify-end gap-2">
                              <Button
                                type="button"
                                variant="secondary"
                                onClick={() =>
                                  setOpenDescriptionGroupId((current) =>
                                    current === group.id ? null : group.id,
                                  )
                                }
                              >
                                <Eye className="mr-2 h-4 w-4" />
                                {openDescriptionGroupId === group.id ? "Ocultar" : "Ver"}
                              </Button>
                              <Button type="button" variant="secondary" onClick={() => startEdit(group)}>
                                <Pencil className="mr-2 h-4 w-4" />
                                Editar
                              </Button>
                              <Button type="button" variant="danger" onClick={() => handleDelete(group)}>
                                <Trash2 className="mr-2 h-4 w-4" />
                                Eliminar
                              </Button>
                            </div>
                          </td>
                        </tr>
                        {openDescriptionGroupId === group.id ? (
                          <tr className="bg-slate-50/80">
                            <td colSpan={6} className="px-4 py-4">
                              <div className="rounded-[12px] border border-slate-200 bg-white p-4">
                                <div className="grid gap-4 lg:grid-cols-3">
                                  <div className="lg:col-span-1">
                                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                                      Descripcion del grupo
                                    </p>
                                    <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-700">
                                      {group.description || "Sin descripcion"}
                                    </p>
                                    <div className="mt-4">
                                      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                                        Estado de prioridad
                                      </p>
                                      <span
                                        className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${
                                          group.priorityStatus === "prioritario"
                                            ? "bg-amber-50 text-amber-700"
                                            : "bg-slate-100 text-slate-600"
                                        }`}
                                      >
                                        {group.priorityStatus === "prioritario" ? "Prioritario" : "Normal"}
                                      </span>
                                    </div>
                                  </div>

                                  <div>
                                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                                      Categorias visibles
                                    </p>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                      {group.modalCategoryNames.length ? (
                                        group.modalCategoryNames.map((categoryName) => (
                                          <span
                                            key={`${group.id}-visible-${categoryName}`}
                                            className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700"
                                          >
                                            {categoryName}
                                          </span>
                                        ))
                                      ) : (
                                        <span className="text-sm text-slate-400">Sin categorias</span>
                                      )}
                                    </div>
                                  </div>

                                  <div>
                                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                                      Categorias mezcladas
                                    </p>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                      {group.taskCategories.length ? (
                                        group.taskCategories.map((categoryName) => (
                                          <span
                                            key={`${group.id}-${categoryName}`}
                                            className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700"
                                          >
                                            {categoryName}
                                          </span>
                                        ))
                                      ) : (
                                        <span className="text-sm text-slate-400">Sin categorias</span>
                                      )}
                                    </div>
                                  </div>

                                  <div>
                                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                                      Tareas que lo componen
                                    </p>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                      {group.taskNames.length ? (
                                        group.taskNames.map((taskName) => (
                                          <span
                                            key={`${group.id}-${taskName}`}
                                            className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700"
                                          >
                                            {taskName}
                                          </span>
                                        ))
                                      ) : (
                                        <span className="text-sm text-slate-400">Sin tareas</span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                        {groupsTableRows.length
                          ? "No encontramos grupos con ese criterio de busqueda."
                          : "Aun no hay grupos registrados."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-500">
              Pagina {visibleGroupsPage} de {totalGroupsPages}
            </p>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setCurrentGroupsPage((currentPage) => Math.max(1, currentPage - 1))}
                disabled={visibleGroupsPage === 1}
              >
                <ChevronLeft className="mr-2 h-4 w-4" />
                Anterior
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  setCurrentGroupsPage((currentPage) => Math.min(totalGroupsPages, currentPage + 1))
                }
                disabled={visibleGroupsPage === totalGroupsPages}
              >
                Siguiente
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        </section>
      </div>

      <FeedbackToast feedback={feedback} onClose={() => setFeedback(null)} />
    </>
  );
}
