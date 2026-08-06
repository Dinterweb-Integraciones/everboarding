"use client";

import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  GripVertical,
  Layers3,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Fragment, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { FeedbackToast } from "@/components/ui/feedback-toast";
import { Input } from "@/components/ui/input";
import { RichTextDisplay, RichTextTextarea } from "@/components/ui/rich-text";
import { Select } from "@/components/ui/select";
import type {
  CreditCatalogGroup,
  CreditCatalogGroupBadgeType,
  CreditCatalogGroupCategory,
  CreditCatalogGroupCategoryLink,
  CreditCatalogGroupItem,
  CreditCatalogItem,
} from "@/lib/onboarding";
import { formatUserError, safeParseNumber } from "@/lib/utils";

type CatalogGroupsManagerProps = {
  initialGroups: CreditCatalogGroup[];
  initialBadgeTypes: CreditCatalogGroupBadgeType[];
  initialGroupCategories: CreditCatalogGroupCategory[];
  initialGroupCategoryLinks: CreditCatalogGroupCategoryLink[];
  initialItems: CreditCatalogItem[];
  initialMemberships: CreditCatalogGroupItem[];
};

const AVAILABLE_TAGS = ["General", "Inmobiliaria", "Salud", "Ecommerce"] as const;
type AvailableTag = (typeof AVAILABLE_TAGS)[number];
const FORM_STEPS = [
  {
    title: "Datos basicos",
    description: "Define identidad, categorias, prioridad y filtros.",
  },
  {
    title: "Contenido",
    description: "Redacta el preview, descripcion y resultados esperados.",
  },
  {
    title: "Composicion",
    description: "Asocia tareas o confirma creditos manuales.",
  },
] as const;

type CatalogGroupForm = {
  name: string;
  description: string;
  preview: string;
  completionOutcome: string;
  successMilestone: string;
  displayBadge: string;
  modalCategoryIds: string[];
  priorityStatus: "normal" | "prioritario";
  credits: string;
  sortOrder: string;
  isActive: boolean;
  isPublic: boolean;
  tags: AvailableTag[];
};

const emptyForm: CatalogGroupForm = {
  name: "",
  description: "",
  preview: "",
  completionOutcome: "",
  successMilestone: "",
  displayBadge: "",
  modalCategoryIds: [],
  priorityStatus: "normal",
  credits: "0",
  sortOrder: "0",
  isActive: true,
  isPublic: true,
  tags: [],
};

function sortCategoryLinks(
  links: CreditCatalogGroupCategoryLink[],
  categoriesById: Map<string, CreditCatalogGroupCategory>,
) {
  return [...links].sort(
    (left, right) =>
      safeParseNumber(categoriesById.get(left.category_id)?.sort_order) -
        safeParseNumber(categoriesById.get(right.category_id)?.sort_order)
      || (categoriesById.get(left.category_id)?.name ?? "").localeCompare(
        categoriesById.get(right.category_id)?.name ?? "",
        "es",
      )
      || safeParseNumber(left.sort_order) - safeParseNumber(right.sort_order)
      || left.created_at.localeCompare(right.created_at)
      || left.id.localeCompare(right.id),
  );
}

function reorderIds(ids: string[], draggedId: string, targetId: string) {
  if (draggedId === targetId) {
    return ids;
  }

  const draggedIndex = ids.indexOf(draggedId);
  const targetIndex = ids.indexOf(targetId);

  if (draggedIndex === -1 || targetIndex === -1) {
    return ids;
  }

  const nextIds = [...ids];
  nextIds.splice(draggedIndex, 1);
  nextIds.splice(targetIndex, 0, draggedId);
  return nextIds;
}

export function CatalogGroupsManager({
  initialGroups,
  initialBadgeTypes,
  initialGroupCategories,
  initialGroupCategoryLinks,
  initialItems,
  initialMemberships,
}: CatalogGroupsManagerProps) {
  const [groups, setGroups] = useState(initialGroups);
  const [badgeTypes, setBadgeTypes] = useState(initialBadgeTypes);
  const [groupCategories] = useState(initialGroupCategories);
  const [groupCategoryLinks, setGroupCategoryLinks] = useState(initialGroupCategoryLinks);
  const [items] = useState(initialItems);
  const [memberships, setMemberships] = useState(initialMemberships);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CatalogGroupForm>(emptyForm);
  const [activeFormStep, setActiveFormStep] = useState(0);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [taskToAdd, setTaskToAdd] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isCategoryMenuOpen, setIsCategoryMenuOpen] = useState(false);
  const [isBadgeTypeModalOpen, setIsBadgeTypeModalOpen] = useState(false);
  const [newBadgeTypeLabel, setNewBadgeTypeLabel] = useState("");
  const [isSavingBadgeType, setIsSavingBadgeType] = useState(false);
  const [groupSearchQuery, setGroupSearchQuery] = useState("");
  const [groupsPageSize, setGroupsPageSize] = useState(10);
  const [currentGroupsPage, setCurrentGroupsPage] = useState(1);
  const [activeOrderingCategoryId, setActiveOrderingCategoryId] = useState<string | null>(null);
  const [isSavingCategoryOrder, setIsSavingCategoryOrder] = useState(false);
  const [draggedOrderingGroupId, setDraggedOrderingGroupId] = useState<string | null>(null);
  const [dropOrderingGroupId, setDropOrderingGroupId] = useState<string | null>(null);
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

  const availableBadgeTypes = useMemo(
    () =>
      [...badgeTypes]
        .filter((badgeType) => badgeType.is_active)
        .sort(
          (left, right) =>
            safeParseNumber(left.sort_order) - safeParseNumber(right.sort_order)
            || left.label.localeCompare(right.label, "es"),
        ),
    [badgeTypes],
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
        const selectedCategoryIds = sortCategoryLinks(
          groupCategoryLinks.filter((link) => link.group_id === group.id),
          groupCategoriesById,
        ).map((link) => link.category_id);
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
          tags: Array.isArray(group.tags) ? group.tags : [],
        };
      }),
    [groupCategoriesById, groupCategoryLinks, items, memberships, sortedGroups],
  );

  const groupRowsById = useMemo(
    () => new Map(groupsTableRows.map((group) => [group.id, group] as const)),
    [groupsTableRows],
  );

  const categoryOrderingRows = useMemo(
    () =>
      availableGroupCategories
        .map((category) => {
          const groupsForCategory = groupCategoryLinks
            .filter((link) => link.category_id === category.id)
            .sort(
              (left, right) =>
                safeParseNumber(left.sort_order) - safeParseNumber(right.sort_order)
                || left.created_at.localeCompare(right.created_at)
                || left.id.localeCompare(right.id),
            )
            .map((link) => groupRowsById.get(link.group_id) ?? null)
            .filter((group): group is (typeof groupsTableRows)[number] => Boolean(group));

          return {
            id: category.id,
            name: category.name,
            description: category.description ?? "",
            groups: groupsForCategory,
          };
        })
        .filter((category) => category.groups.length > 0),
    [availableGroupCategories, groupCategoryLinks, groupRowsById],
  );

  const activeOrderingCategory = useMemo(
    () =>
      categoryOrderingRows.find((category) => category.id === activeOrderingCategoryId)
      ?? categoryOrderingRows[0]
      ?? null,
    [activeOrderingCategoryId, categoryOrderingRows],
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
        group.preview ?? "",
        group.completion_outcome ?? "",
        group.success_milestone ?? "",
        group.display_badge ?? "",
        group.modalCategoryNames.join(" "),
        group.priorityStatus,
        group.priorityStatus === "prioritario" ? "prioritario" : "normal",
        group.is_active ? "activo" : "inactivo",
        group.is_public ? "publico" : "privado",
        `${group.totalCredits} cr`,
        `${group.taskCount} tareas`,
        group.taskNames.join(" "),
        group.taskCategories.join(" "),
        group.tags.join(" "),
      ].some((value) => value.toLowerCase().includes(normalizedQuery)),
    );
  }, [deferredGroupSearchQuery, groupsTableRows]);

  const totalGroupsPages = Math.max(1, Math.ceil(filteredGroupsTableRows.length / groupsPageSize));
  const visibleGroupsPage = Math.min(currentGroupsPage, totalGroupsPages);

  useEffect(() => {
    setCurrentGroupsPage((currentPage) => Math.min(currentPage, totalGroupsPages));
  }, [totalGroupsPages]);

  useEffect(() => {
    if (!categoryOrderingRows.length) {
      if (activeOrderingCategoryId !== null) {
        setActiveOrderingCategoryId(null);
      }
      return;
    }

    if (!activeOrderingCategoryId || !categoryOrderingRows.some((category) => category.id === activeOrderingCategoryId)) {
      setActiveOrderingCategoryId(categoryOrderingRows[0].id);
    }
  }, [activeOrderingCategoryId, categoryOrderingRows]);

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
    setActiveFormStep(0);
    setIsCategoryMenuOpen(false);
  }

  function startEdit(group: CreditCatalogGroup) {
    const selectedCategoryIds = sortCategoryLinks(
      groupCategoryLinks.filter((link) => link.group_id === group.id),
      groupCategoriesById,
    )
      .map((link) => link.category_id)
      .filter((categoryId, index, current) => current.indexOf(categoryId) === index);

    setEditingId(group.id);
    setForm({
      name: group.name,
      description: group.description ?? "",
      preview: group.preview ?? "",
      completionOutcome: group.completion_outcome ?? "",
      successMilestone: group.success_milestone ?? "",
      displayBadge: group.display_badge ?? "",
      modalCategoryIds: selectedCategoryIds.length
        ? selectedCategoryIds
        : group.modal_category_id
          ? [group.modal_category_id]
          : [],
      priorityStatus: group.priority_status === "prioritario" ? "prioritario" : "normal",
      credits: String(group.credits ?? 0),
      sortOrder: String(group.sort_order ?? 0),
      isActive: group.is_active,
      isPublic: group.is_public,
      tags: Array.isArray(group.tags)
        ? (group.tags.filter((tag): tag is AvailableTag => (AVAILABLE_TAGS as readonly string[]).includes(tag)))
        : [],
    });
    setSelectedTaskIds(
      memberships
        .filter((membership) => membership.group_id === group.id)
        .sort((left, right) => safeParseNumber(left.sort_order) - safeParseNumber(right.sort_order))
        .map((membership) => membership.catalog_item_id),
    );
    setTaskToAdd("");
    setActiveFormStep(0);
    setIsCategoryMenuOpen(false);
  }

  function goToNextFormStep() {
    if (activeFormStep === 0 && !form.name.trim()) {
      setFeedback({ tone: "error", message: "Escribe el titulo del caso de uso antes de continuar." });
      return;
    }

    setFeedback(null);
    setActiveFormStep((current) => Math.min(FORM_STEPS.length - 1, current + 1));
  }

  function goToPreviousFormStep() {
    setFeedback(null);
    setActiveFormStep((current) => Math.max(0, current - 1));
  }

  function attachTaskToDraft() {
    if (!taskToAdd || selectedTaskIds.includes(taskToAdd)) return;
    setSelectedTaskIds((current) => [...current, taskToAdd]);
    setTaskToAdd("");
  }

  function detachTaskFromDraft(taskId: string) {
    setSelectedTaskIds((current) => current.filter((currentId) => currentId !== taskId));
  }

  async function saveBadgeType() {
    const label = newBadgeTypeLabel.trim();
    if (!label) {
      setFeedback({ tone: "error", message: "Escribe el nombre de la etiqueta." });
      return;
    }

    setIsSavingBadgeType(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/cs/catalog-group-badge-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label,
          sortOrder: availableBadgeTypes.length,
          isActive: true,
        }),
      });

      const payload = (await response.json()) as CreditCatalogGroupBadgeType & { message?: string };
      if (!response.ok) {
        throw new Error(payload.message || "No pudimos crear la etiqueta.");
      }

      setBadgeTypes((current) => [...current, payload]);
      setForm((current) => ({ ...current, displayBadge: payload.label }));
      setNewBadgeTypeLabel("");
      setIsBadgeTypeModalOpen(false);
      setFeedback({ tone: "success", message: "Etiqueta creada." });
    } catch (caughtError) {
      setFeedback({
        tone: "error",
        message: formatUserError(caughtError, "No pudimos crear la etiqueta."),
      });
    } finally {
      setIsSavingBadgeType(false);
    }
  }

  function toggleModalCategory(categoryId: string) {
    setForm((current) => ({
      ...current,
      modalCategoryIds: current.modalCategoryIds.includes(categoryId)
        ? current.modalCategoryIds.filter((currentId) => currentId !== categoryId)
        : [...current.modalCategoryIds, categoryId],
    }));
  }

  function buildLocalCategoryLinks(groupId: string, selectedCategoryIds: string[]) {
    const existingLinksByCategoryId = new Map(
      groupCategoryLinks
        .filter((link) => link.group_id === groupId)
        .map((link) => [link.category_id, link] as const),
    );

    return selectedCategoryIds.map((categoryId) => {
      const existingLink = existingLinksByCategoryId.get(categoryId);
      if (existingLink) {
        return existingLink;
      }

      const currentMax = Math.max(
        -1,
        ...groupCategoryLinks
          .filter((link) => link.category_id === categoryId && link.group_id !== groupId)
          .map((link) => safeParseNumber(link.sort_order)),
      );

      return {
        id: crypto.randomUUID(),
        group_id: groupId,
        category_id: categoryId,
        sort_order: currentMax + 1,
        created_at: new Date().toISOString(),
      } satisfies CreditCatalogGroupCategoryLink;
    });
  }

  function applyCategoryOrderLocally(
    currentLinks: CreditCatalogGroupCategoryLink[],
    categoryId: string,
    orderedGroupIds: string[],
  ) {
    const nextSortOrderByGroupId = new Map(orderedGroupIds.map((groupId, index) => [groupId, index] as const));

    return currentLinks.map((link) =>
      link.category_id === categoryId && nextSortOrderByGroupId.has(link.group_id)
        ? { ...link, sort_order: nextSortOrderByGroupId.get(link.group_id) ?? link.sort_order }
        : link,
    );
  }

  async function persistCategoryOrdering(categoryId: string, orderedGroupIds: string[]) {
    const previousLinks = groupCategoryLinks;
    setIsSavingCategoryOrder(true);
    setFeedback(null);
    setGroupCategoryLinks((current) => applyCategoryOrderLocally(current, categoryId, orderedGroupIds));

    try {
      const response = await fetch(`/api/cs/catalog-group-categories/${categoryId}/reorder-groups`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupIds: orderedGroupIds }),
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message || "No pudimos reordenar los grupos de la categoria.");
      }

      setFeedback({ tone: "success", message: "Orden por categoria actualizado." });
    } catch (caughtError) {
      setGroupCategoryLinks(previousLinks);
      setFeedback({
        tone: "error",
        message: formatUserError(caughtError, "No pudimos reordenar los grupos de la categoria."),
      });
    } finally {
      setIsSavingCategoryOrder(false);
      setDraggedOrderingGroupId(null);
      setDropOrderingGroupId(null);
    }
  }

  function moveGroupInsideCategory(categoryId: string, groupId: string, direction: "up" | "down") {
    const categoryRow = categoryOrderingRows.find((category) => category.id === categoryId);
    if (!categoryRow) {
      return;
    }

    const orderedGroupIds = categoryRow.groups.map((group) => group.id);
    const currentIndex = orderedGroupIds.indexOf(groupId);
    const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

    if (currentIndex === -1 || nextIndex < 0 || nextIndex >= orderedGroupIds.length) {
      return;
    }

    const nextOrderedGroupIds = [...orderedGroupIds];
    const [movedGroupId] = nextOrderedGroupIds.splice(currentIndex, 1);
    nextOrderedGroupIds.splice(nextIndex, 0, movedGroupId);
    void persistCategoryOrdering(categoryId, nextOrderedGroupIds);
  }

  function handleOrderingDrop(categoryId: string, targetGroupId: string) {
    if (!draggedOrderingGroupId) {
      return;
    }

    const categoryRow = categoryOrderingRows.find((category) => category.id === categoryId);
    if (!categoryRow) {
      return;
    }

    const currentOrderedGroupIds = categoryRow.groups.map((group) => group.id);
    const nextOrderedGroupIds = reorderIds(currentOrderedGroupIds, draggedOrderingGroupId, targetGroupId);

    if (nextOrderedGroupIds.join("|") === currentOrderedGroupIds.join("|")) {
      setDraggedOrderingGroupId(null);
      setDropOrderingGroupId(null);
      return;
    }

    void persistCategoryOrdering(categoryId, nextOrderedGroupIds);
  }

  async function saveGroup() {
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
            preview: form.preview,
            completionOutcome: form.completionOutcome,
            successMilestone: form.successMilestone,
            displayBadge: form.displayBadge,
            modalCategoryIds: form.modalCategoryIds,
            priorityStatus: form.priorityStatus,
            credits: manualCredits,
            sortOrder: safeParseNumber(form.sortOrder),
            isActive: form.isActive,
            isPublic: form.isPublic,
            taskIds: selectedTaskIds,
            tags: form.tags.length ? form.tags : null,
          }),
        },
      );

      const payload = (await response.json()) as CreditCatalogGroup & { message?: string };
      if (!response.ok) {
        throw new Error(payload.message || "No pudimos guardar el grupo.");
      }

      const nextCategoryLinks = buildLocalCategoryLinks(payload.id, form.modalCategoryIds);
      const nextMemberships = selectedTaskIds.map((taskId, index) => ({
        id: crypto.randomUUID(),
        group_id: payload.id,
        catalog_item_id: taskId,
        sort_order: index,
        created_at: new Date().toISOString(),
      })) satisfies CreditCatalogGroupItem[];

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

          <form className="mt-6 space-y-5" onSubmit={(event) => event.preventDefault()}>
            <div className="grid gap-3 lg:grid-cols-3">
              {FORM_STEPS.map((step, index) => {
                const isActive = activeFormStep === index;
                const isCompleted = activeFormStep > index;

                return (
                  <button
                    key={step.title}
                    type="button"
                    onClick={() => {
                      if (index <= activeFormStep || form.name.trim()) {
                        setActiveFormStep(index);
                      }
                    }}
                    className={`rounded-[14px] border px-4 py-3 text-left transition ${
                      isActive
                        ? "border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_8%,white)] shadow-sm"
                        : isCompleted
                          ? "border-emerald-200 bg-emerald-50"
                          : "border-slate-200 bg-slate-50 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`grid h-7 w-7 place-items-center rounded-full text-xs font-black ${
                          isActive
                            ? "bg-[var(--accent)] text-white"
                            : isCompleted
                              ? "bg-emerald-500 text-white"
                              : "bg-white text-slate-500"
                        }`}
                      >
                        {index + 1}
                      </span>
                      <span className="font-bold text-slate-900">{step.title}</span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-500">{step.description}</p>
                  </button>
                );
              })}
            </div>

            {activeFormStep === 0 ? (
              <>
            <div className="grid gap-5 xl:grid-cols-12 xl:items-start">
              <div className="xl:col-span-5">
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

              <div className="xl:col-span-4">
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Etiqueta de tarjeta
                </label>
                <div className="relative">
                  <Select
                    value={form.displayBadge ?? ""}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, displayBadge: event.target.value }))
                    }
                    className="pr-14"
                  >
                    <option value="">Automatico</option>
                    {form.displayBadge.trim() &&
                    !availableBadgeTypes.some((badgeType) => badgeType.label === form.displayBadge.trim()) ? (
                      <option value={form.displayBadge.trim()}>{form.displayBadge.trim()}</option>
                    ) : null}
                    {availableBadgeTypes.map((badgeType) => (
                      <option key={badgeType.id} value={badgeType.label}>
                        {badgeType.label}
                      </option>
                    ))}
                  </Select>
                  <button
                    type="button"
                    onClick={() => setIsBadgeTypeModalOpen(true)}
                    className="absolute right-1.5 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg border border-[var(--accent)] bg-white text-[var(--accent)] transition hover:bg-[color-mix(in_oklab,var(--accent)_10%,white)]"
                    aria-label="Crear etiqueta de tarjeta"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Si queda vacia, no se muestra etiqueta secundaria en la tarjeta.
                </p>
              </div>

              <div className="rounded-[14px] border border-slate-200 bg-slate-50/70 p-4 xl:col-span-3 xl:row-span-2">
                <div className="grid gap-3">
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
                      className="bg-white"
                    />
                  </div>

                  <label className="flex items-center gap-3 rounded-[12px] border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 shadow-sm">
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
                  <div className="flex items-center justify-between gap-3 rounded-[12px] border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
                    <div>
                      <p className="text-sm font-semibold text-slate-700">Visibilidad</p>
                      <p
                        className={`text-xs font-bold ${
                          form.isPublic ? "text-emerald-700" : "text-violet-700"
                        }`}
                      >
                        {form.isPublic ? "Publico" : "Privado"}
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={form.isPublic}
                      aria-label={`Cambiar visibilidad a ${form.isPublic ? "privado" : "publico"}`}
                      onClick={() =>
                        setForm((current) => ({ ...current, isPublic: !current.isPublic }))
                      }
                      className={`inline-flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 ${
                        form.isPublic ? "bg-emerald-500" : "bg-violet-500"
                      }`}
                    >
                      <span
                        className={`h-5 w-5 rounded-full bg-white shadow-sm transition ${
                          form.isPublic ? "translate-x-5" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>
                  <p className="text-xs leading-5 text-slate-500">
                    Los casos privados solo aparecen para vendedores y CS. Si agregas tareas, el total se calcula con ellas.
                  </p>
                </div>
              </div>

              <div className="xl:col-span-5">
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

              <div className="xl:col-span-4">
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

              </>
            ) : null}

            {activeFormStep === 1 ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Preview
                </label>
                <RichTextTextarea
                  rows={3}
                  value={form.preview}
                  onChange={(value) => setForm((current) => ({ ...current, preview: value }))}
                  placeholder="Resumen corto para mostrar en tarjetas del catalogo."
                />
              </div>

              <div>
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Descripcion
                </label>
                <RichTextTextarea
                  rows={3}
                  value={form.description}
                  onChange={(value) => setForm((current) => ({ ...current, description: value }))}
                  placeholder="Describe para que sirve este caso de uso o conglomerado de tareas."
                />
              </div>

              <div>
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Al terminar el caso de uso
                </label>
                <RichTextTextarea
                  rows={3}
                  value={form.completionOutcome}
                  onChange={(value) =>
                    setForm((current) => ({ ...current, completionOutcome: value }))
                  }
                  placeholder="Describe que deberia quedar implementado al finalizar."
                />
              </div>

              <div>
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Hito de exito
                </label>
                <RichTextTextarea
                  rows={3}
                  value={form.successMilestone}
                  onChange={(value) =>
                    setForm((current) => ({ ...current, successMilestone: value }))
                  }
                  placeholder="Define el indicador o resultado que confirma el exito."
                />
              </div>
            </div>
            ) : null}

            {activeFormStep === 0 ? (
            <div>
              <label className="mb-3 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                Etiquetas de industria
              </label>
              <div className="flex flex-wrap gap-3">
                {AVAILABLE_TAGS.map((tag) => {
                  const selected = form.tags.includes(tag);
                  return (
                    <label
                      key={tag}
                      className={`flex cursor-pointer items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition ${
                        selected
                          ? "border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_10%,white)] text-[var(--accent)]"
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() =>
                          setForm((current) => ({
                            ...current,
                            tags: current.tags.includes(tag)
                              ? current.tags.filter((t) => t !== tag)
                              : [...current.tags, tag],
                          }))
                        }
                        className="sr-only"
                      />
                      {tag}
                    </label>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-slate-400">Opcional. Permite filtrar grupos por industria.</p>
            </div>
            ) : null}

            {activeFormStep === 2 ? (
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
            ) : null}

            <div className="flex flex-wrap gap-3">
              {activeFormStep > 0 ? (
                <Button type="button" variant="secondary" onClick={goToPreviousFormStep} disabled={isSaving}>
                  Anterior
                </Button>
              ) : null}
              {activeFormStep < FORM_STEPS.length - 1 ? (
                <Button type="button" onClick={goToNextFormStep} disabled={isSaving}>
                  Siguiente
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              ) : (
                <Button type="button" onClick={() => void saveGroup()} disabled={isSaving}>
                  <Plus className="mr-2 h-4 w-4" />
                  {isSaving ? "Guardando..." : editingId ? "Actualizar caso" : "Guardar caso"}
                </Button>
              )}
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

          <div className="mt-6 rounded-[16px] border border-slate-200 bg-slate-50/80 p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                  Orden por categoria
                </p>
                <h3 className="mt-1 text-lg font-black text-slate-900">Prioriza casos de uso dentro de cada categoria</h3>
                <p className="mt-2 max-w-2xl text-sm text-slate-600">
                  Arrastra las tarjetas o usa subir y bajar. Este orden se refleja en el catalogo visible para ventas y onboarding.
                </p>
              </div>
              <div className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-500">
                {isSavingCategoryOrder ? "Guardando orden..." : "Orden manual activo"}
              </div>
            </div>

            {categoryOrderingRows.length ? (
              <div className="mt-4 grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
                <div className="flex flex-col gap-2">
                  {categoryOrderingRows.map((category) => {
                    const selected = activeOrderingCategory?.id === category.id;
                    return (
                      <button
                        key={category.id}
                        type="button"
                        onClick={() => setActiveOrderingCategoryId(category.id)}
                        className={`rounded-[14px] border px-4 py-3 text-left transition ${
                          selected
                            ? "border-[var(--accent)] bg-white shadow-sm"
                            : "border-slate-200 bg-white/70 hover:border-slate-300"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-semibold text-slate-900">{category.name}</span>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                            {category.groups.length}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {category.description || "Sin descripcion"}
                        </p>
                      </button>
                    );
                  })}
                </div>

                <div className="rounded-[16px] border border-slate-200 bg-white p-4">
                  {activeOrderingCategory ? (
                    <>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{activeOrderingCategory.name}</p>
                          <p className="text-xs text-slate-500">
                            {activeOrderingCategory.groups.length} casos de uso en esta categoria
                          </p>
                        </div>
                        <p className="text-xs text-slate-400">El primero aparece primero en el catalogo</p>
                      </div>

                      <div className="mt-4 space-y-3">
                        {activeOrderingCategory.groups.map((group, index) => (
                          <div
                            key={`${activeOrderingCategory.id}-${group.id}`}
                            draggable={!isSavingCategoryOrder}
                            onDragStart={(event) => {
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData("text/plain", group.id);
                              setDraggedOrderingGroupId(group.id);
                            }}
                            onDragEnd={() => {
                              setDraggedOrderingGroupId(null);
                              setDropOrderingGroupId(null);
                            }}
                            onDragOver={(event) => {
                              event.preventDefault();
                              if (isSavingCategoryOrder) {
                                return;
                              }
                              event.dataTransfer.dropEffect = "move";
                              setDropOrderingGroupId(group.id);
                            }}
                            onDragLeave={() => {
                              setDropOrderingGroupId((current) => (current === group.id ? null : current));
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              handleOrderingDrop(activeOrderingCategory.id, group.id);
                            }}
                            className={`rounded-[14px] border px-4 py-3 transition ${
                              dropOrderingGroupId === group.id
                                ? "border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_8%,white)]"
                                : "border-slate-200 bg-slate-50/60"
                            } ${isSavingCategoryOrder ? "opacity-70" : "cursor-grab active:cursor-grabbing"}`}
                          >
                            <div className="flex items-start gap-3">
                              <div className="flex items-center gap-3 pt-1">
                                <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-slate-500">
                                  #{index + 1}
                                </span>
                                <GripVertical className="h-4 w-4 text-slate-400" />
                              </div>

                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="font-semibold text-slate-900">{group.name}</p>
                                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                                    {group.totalCredits} CR
                                  </span>
                                  <span
                                    className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                                      group.priorityStatus === "prioritario"
                                        ? "bg-amber-50 text-amber-700"
                                        : "bg-slate-100 text-slate-500"
                                    }`}
                                  >
                                    {group.priorityStatus === "prioritario" ? "Prioritario" : "Normal"}
                                  </span>
                                  {!group.is_active ? (
                                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                                      Inactivo
                                    </span>
                                  ) : null}
                                </div>
                                <RichTextDisplay
                                  value={group.preview || group.description}
                                  fallback="Sin preview"
                                  className="mt-1 text-sm text-slate-600"
                                />
                              </div>

                              <div className="flex shrink-0 flex-col gap-2">
                                <Button
                                  type="button"
                                  variant="secondary"
                                  onClick={() => moveGroupInsideCategory(activeOrderingCategory.id, group.id, "up")}
                                  disabled={isSavingCategoryOrder || index === 0}
                                >
                                  <ArrowUp className="mr-2 h-4 w-4" />
                                  Subir
                                </Button>
                                <Button
                                  type="button"
                                  variant="secondary"
                                  onClick={() => moveGroupInsideCategory(activeOrderingCategory.id, group.id, "down")}
                                  disabled={isSavingCategoryOrder || index === activeOrderingCategory.groups.length - 1}
                                >
                                  <ArrowDown className="mr-2 h-4 w-4" />
                                  Bajar
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-[14px] border border-dashed border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
                Aun no hay categorias con casos de uso asociados para ordenar.
              </div>
            )}
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
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                      Visibilidad
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
                            {group.display_badge?.trim() ? (
                              <div className="mt-1 text-xs font-semibold text-[var(--accent)]">
                                {group.display_badge.trim()}
                              </div>
                            ) : null}
                            {group.tags.length ? (
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {group.tags.map((tag) => (
                                  <span
                                    key={tag}
                                    className="rounded-full bg-[color-mix(in_oklab,var(--accent)_10%,white)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent)]"
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            ) : null}
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
                            <span
                              className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                                group.is_public
                                  ? "bg-sky-50 text-sky-700"
                                  : "bg-violet-50 text-violet-700"
                              }`}
                            >
                              {group.is_public ? "Publico" : "Privado"}
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
                            <td colSpan={7} className="px-4 py-4">
                              <div className="rounded-[12px] border border-slate-200 bg-white p-4">
                                <div className="grid gap-4 lg:grid-cols-3">
                                  <div className="lg:col-span-1">
                                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                                      Preview
                                    </p>
                                    <RichTextDisplay
                                      value={group.preview}
                                      fallback="Sin preview"
                                      className="mt-2"
                                    />
                                    <div className="mt-4">
                                      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                                        Descripcion
                                      </p>
                                      <RichTextDisplay
                                        value={group.description}
                                        fallback="Sin descripcion"
                                        className="mt-2"
                                      />
                                    </div>
                                    <div className="mt-4">
                                      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                                        Al terminar el caso de uso
                                      </p>
                                      <RichTextDisplay
                                        value={group.completion_outcome}
                                        fallback="Sin resultado definido"
                                        className="mt-2"
                                      />
                                    </div>
                                    <div className="mt-4">
                                      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                                        Hito de exito
                                      </p>
                                      <RichTextDisplay
                                        value={group.success_milestone}
                                        fallback="Sin hito definido"
                                        className="mt-2"
                                      />
                                    </div>
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
                                    {group.display_badge?.trim() ? (
                                      <div className="mt-4">
                                        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                                          Etiqueta de tarjeta
                                        </p>
                                        <span className="mt-2 inline-flex rounded-full bg-[color-mix(in_oklab,var(--accent)_10%,white)] px-2.5 py-1 text-xs font-semibold text-[var(--accent)]">
                                          {group.display_badge.trim()}
                                        </span>
                                      </div>
                                    ) : null}
                                    {group.tags.length ? (
                                      <div className="mt-4">
                                        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                                          Etiquetas de industria
                                        </p>
                                        <div className="mt-2 flex flex-wrap gap-2">
                                          {group.tags.map((tag) => (
                                            <span
                                              key={tag}
                                              className="rounded-full bg-[color-mix(in_oklab,var(--accent)_10%,white)] px-2.5 py-1 text-xs font-semibold text-[var(--accent)]"
                                            >
                                              {tag}
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                    ) : null}
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
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
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

      {isBadgeTypeModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6">
          <div className="w-full max-w-md rounded-[16px] border border-slate-200 bg-white p-5 shadow-[0_24px_70px_rgba(15,23,42,0.22)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--accent)]">
                  Nueva etiqueta
                </p>
                <h3 className="mt-1 text-lg font-bold text-slate-950">Etiqueta de tarjeta</h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsBadgeTypeModalOpen(false);
                  setNewBadgeTypeLabel("");
                }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                aria-label="Cerrar modal de etiqueta"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5">
              <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                Nombre
              </label>
              <Input
                value={newBadgeTypeLabel}
                onChange={(event) => setNewBadgeTypeLabel(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void saveBadgeType();
                  }
                }}
                placeholder="Grupo manual"
                autoFocus
              />
            </div>

            {availableBadgeTypes.length ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {availableBadgeTypes.map((badgeType) => (
                  <button
                    key={badgeType.id}
                    type="button"
                    onClick={() => setNewBadgeTypeLabel(badgeType.label)}
                    className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  >
                    {badgeType.label}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="mt-6 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setIsBadgeTypeModalOpen(false);
                  setNewBadgeTypeLabel("");
                }}
                disabled={isSavingBadgeType}
              >
                Cancelar
              </Button>
              <Button type="button" onClick={() => void saveBadgeType()} disabled={isSavingBadgeType}>
                <Plus className="mr-2 h-4 w-4" />
                {isSavingBadgeType ? "Guardando..." : "Agregar"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <FeedbackToast feedback={feedback} onClose={() => setFeedback(null)} />
    </>
  );
}
