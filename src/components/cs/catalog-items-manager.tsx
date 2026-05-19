"use client";

import { CheckSquare, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { FeedbackToast } from "@/components/ui/feedback-toast";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type {
  CreditCatalogCategory,
  CreditCatalogGroup,
  CreditCatalogGroupItem,
  CreditCatalogItem,
} from "@/lib/onboarding";
import { formatUserError, safeParseNumber } from "@/lib/utils";

type CatalogItemsManagerProps = {
  initialItems: CreditCatalogItem[];
  groups: CreditCatalogGroup[];
  memberships: CreditCatalogGroupItem[];
  categories: CreditCatalogCategory[];
};

const emptyForm = {
  category: "General",
  label: "",
  credits: "1",
  sortOrder: "0",
  isActive: true,
};

const PAGE_SIZE_OPTIONS = [10, 25, 50];

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function CatalogItemsManager({
  initialItems,
  groups,
  memberships,
  categories,
}: CatalogItemsManagerProps) {
  const [items, setItems] = useState(initialItems);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [isSaving, setIsSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);

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
      const sameCountAsCategory =
        taskRows.length > 0 && taskRows.length === items.filter((item) => item.category === group.name).length;

      const looksLikeLegacyMirror =
        !group.created_by_user_id &&
        !group.description &&
        safeParseNumber(group.credits) === 0 &&
        allTasksMatchCategory &&
        sameCountAsCategory;

      return !looksLikeLegacyMirror;
    });
  }, [groups, items, memberships]);

  const visibleGroupMap = useMemo(
    () => new Map(visibleGroups.map((group) => [group.id, group])),
    [visibleGroups],
  );

  const availableCategories = useMemo(() => {
    const names = new Set(categories.filter((category) => category.is_active).map((category) => category.name));
    if (form.category) {
      names.add(form.category);
    }
    return [...names].sort((left, right) => left.localeCompare(right, "es"));
  }, [categories, form.category]);

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

  const itemGroupsByItemId = useMemo(() => {
    const nextMap = new Map<string, string[]>();

    for (const membership of memberships) {
      const groupName = visibleGroupMap.get(membership.group_id)?.name;
      if (!groupName) {
        continue;
      }

      const currentNames = nextMap.get(membership.catalog_item_id) ?? [];
      currentNames.push(groupName);
      nextMap.set(membership.catalog_item_id, currentNames);
    }

    return nextMap;
  }, [memberships, visibleGroupMap]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = normalizeSearchText(searchQuery);
    if (!normalizedQuery) {
      return sortedItems;
    }

    return sortedItems.filter((item) => {
      const itemGroups = itemGroupsByItemId.get(item.id) ?? [];
      const searchableText = [
        item.label,
        item.category,
        itemGroups.join(" "),
        `${item.credits} cr`,
        item.is_active ? "activa" : "inactiva",
      ].join(" ");

      return normalizeSearchText(searchableText).includes(normalizedQuery);
    });
  }, [itemGroupsByItemId, searchQuery, sortedItems]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));

  const paginatedItems = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredItems.slice(startIndex, startIndex + pageSize);
  }, [currentPage, filteredItems, pageSize]);

  const visiblePageNumbers = useMemo(() => {
    const maxVisiblePages = 5;
    const halfWindow = Math.floor(maxVisiblePages / 2);
    let startPage = Math.max(1, currentPage - halfWindow);
    const endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

    startPage = Math.max(1, endPage - maxVisiblePages + 1);

    return Array.from({ length: endPage - startPage + 1 }, (_, index) => startPage + index);
  }, [currentPage, totalPages]);

  const pageRangeStart = filteredItems.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const pageRangeEnd = Math.min(currentPage * pageSize, filteredItems.length);

  useEffect(() => {
    setCurrentPage(1);
  }, [pageSize, searchQuery]);

  useEffect(() => {
    setCurrentPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
  }

  function startEdit(item: CreditCatalogItem) {
    setEditingId(item.id);
    setForm({
      category: item.category,
      label: item.label,
      credits: String(item.credits),
      sortOrder: String(item.sort_order ?? 0),
      isActive: item.is_active,
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setFeedback(null);

    try {
      const response = await fetch(
        editingId ? `/api/cs/catalog-items/${editingId}` : "/api/cs/catalog-items",
        {
          method: editingId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category: form.category,
            label: form.label,
            credits: safeParseNumber(form.credits),
            sortOrder: safeParseNumber(form.sortOrder),
            isActive: form.isActive,
          }),
        },
      );

      const payload = (await response.json()) as CreditCatalogItem & { message?: string };
      if (!response.ok) {
        throw new Error(payload.message || "No pudimos guardar la actividad.");
      }

      if (editingId) {
        setItems((current) =>
          current.map((item) => (item.id === editingId ? { ...item, ...payload } : item)),
        );
        setFeedback({ tone: "success", message: "Actividad actualizada." });
      } else {
        setItems((current) => [...current, payload]);
        setFeedback({ tone: "success", message: "Actividad creada." });
      }

      resetForm();
    } catch (caughtError) {
      setFeedback({
        tone: "error",
        message: formatUserError(caughtError, "No pudimos guardar la actividad."),
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(item: CreditCatalogItem) {
    const confirmed = window.confirm(`Eliminar "${item.label}" del catalogo de actividades?`);
    if (!confirmed) return;

    try {
      const response = await fetch(`/api/cs/catalog-items/${item.id}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message || "No pudimos eliminar la actividad.");
      }

      setItems((current) => current.filter((currentItem) => currentItem.id !== item.id));
      if (editingId === item.id) {
        resetForm();
      }
      setFeedback({ tone: "success", message: "Actividad eliminada." });
    } catch (caughtError) {
      setFeedback({
        tone: "error",
        message: formatUserError(caughtError, "No pudimos eliminar la actividad."),
      });
    }
  }

  return (
    <>
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <section className="rounded-[18px] border border-slate-200 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.05)]">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-[var(--accent)]">
              <CheckSquare className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                CRUD CS
              </p>
              <h1 className="text-2xl font-black text-slate-900">Gestion de actividades</h1>
            </div>
          </div>

          <p className="mt-4 text-sm text-slate-600">
            Aqui registras actividades base.
          </p>

          <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px_140px]">
              <div>
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Nombre de la actividad
                </label>
                <Input
                  value={form.label}
                  onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))}
                  placeholder="Sprint de Integridad de Datos"
                />
              </div>
              <div>
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Categoria
                </label>
                <Select
                  value={form.category}
                  onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
                >
                  {availableCategories.map((categoryName) => (
                    <option key={categoryName} value={categoryName}>
                      {categoryName}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Creditos
                </label>
                <Input
                  type="number"
                  min={1}
                  value={form.credits}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, credits: event.target.value }))
                  }
                />
              </div>
            </div>

            <div className="rounded-[12px] border border-slate-200 bg-slate-50 px-4 py-3">
              <label className="flex items-center gap-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, isActive: event.target.checked }))
                  }
                  className="h-4 w-4 rounded border-slate-300 text-[var(--accent)] focus:ring-[var(--accent)]"
                />
                Actividad activa
              </label>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={isSaving}>
                <Plus className="mr-2 h-4 w-4" />
                {isSaving ? "Guardando..." : editingId ? "Actualizar actividad" : "Crear actividad"}
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
              <h2 className="mt-1 text-xl font-black text-slate-900">Actividades registradas</h2>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
              {filteredItems.length} {filteredItems.length === 1 ? "actividad" : "actividades"}
            </span>
          </div>

          <div className="mt-5 flex flex-col gap-4 rounded-[14px] border border-slate-200 bg-slate-50/70 p-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="w-full max-w-xl">
              <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                Buscar actividad
              </label>
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Buscar por actividad, categoria, grupo, creditos o estado"
              />
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="min-w-[140px]">
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Por pagina
                </label>
                <Select
                  value={String(pageSize)}
                  onChange={(event) => setPageSize(safeParseNumber(event.target.value) || 10)}
                >
                  {PAGE_SIZE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              </div>

              <p className="text-sm text-slate-600">
                Mostrando {pageRangeStart}-{pageRangeEnd} de {filteredItems.length} actividades
              </p>
            </div>
          </div>

          <div className="mt-5 overflow-hidden rounded-[14px] border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                    Actividad
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                    Categoria
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                    En grupos
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                    Creditos
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
                {paginatedItems.length ? (
                  paginatedItems.map((item) => {
                    const itemGroups = itemGroupsByItemId.get(item.id) ?? [];

                    return (
                      <tr key={item.id}>
                        <td className="px-4 py-4 font-semibold text-slate-900">{item.label}</td>
                        <td className="px-4 py-4 text-slate-600">{item.category}</td>
                        <td className="px-4 py-4">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                              itemGroups.length
                                ? "border border-slate-200 bg-slate-50 text-slate-700"
                                : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            {itemGroups.length === 0
                              ? "0 grupos"
                              : itemGroups.length === 1
                                ? "1 grupo"
                                : `${itemGroups.length} grupos`}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-slate-600">{item.credits} CR</td>
                        <td className="px-4 py-4">
                          <span
                            className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                              item.is_active
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-slate-200 text-slate-600"
                            }`}
                          >
                            {item.is_active ? "Activa" : "Inactiva"}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex justify-end gap-2">
                            <Button type="button" variant="secondary" onClick={() => startEdit(item)}>
                              <Pencil className="mr-2 h-4 w-4" />
                              Editar
                            </Button>
                            <Button type="button" variant="danger" onClick={() => handleDelete(item)}>
                              <Trash2 className="mr-2 h-4 w-4" />
                              Eliminar
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                      {filteredItems.length === 0 && searchQuery
                        ? "No encontramos actividades con ese criterio de busqueda."
                        : "Aun no hay actividades registradas."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <p className="text-sm text-slate-600">
              Pagina {currentPage} de {totalPages}
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setCurrentPage((current) => Math.max(1, current - 1))}
                disabled={currentPage === 1}
              >
                Anterior
              </Button>

              {visiblePageNumbers.map((pageNumber) => (
                <Button
                  key={pageNumber}
                  type="button"
                  variant={pageNumber === currentPage ? "primary" : "secondary"}
                  onClick={() => setCurrentPage(pageNumber)}
                  className="min-w-[44px] px-3"
                >
                  {pageNumber}
                </Button>
              ))}

              <Button
                type="button"
                variant="secondary"
                onClick={() => setCurrentPage((current) => Math.min(totalPages, current + 1))}
                disabled={currentPage === totalPages}
              >
                Siguiente
              </Button>
            </div>
          </div>
        </section>
      </div>

      <FeedbackToast feedback={feedback} onClose={() => setFeedback(null)} />
    </>
  );
}
