"use client";

import { CheckSquare, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

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
      const sameCountAsCategory = taskRows.length > 0
        && taskRows.length === items.filter((item) => item.category === group.name).length;

      const looksLikeLegacyMirror =
        !group.created_by_user_id &&
        !group.description &&
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
        throw new Error(payload.message || "No pudimos guardar la tarea.");
      }

      if (editingId) {
        setItems((current) =>
          current.map((item) => (item.id === editingId ? { ...item, ...payload } : item)),
        );
        setFeedback({ tone: "success", message: "Tarea actualizada." });
      } else {
        setItems((current) => [...current, payload]);
        setFeedback({ tone: "success", message: "Tarea creada." });
      }

      resetForm();
    } catch (caughtError) {
      setFeedback({
        tone: "error",
        message: formatUserError(caughtError, "No pudimos guardar la tarea."),
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(item: CreditCatalogItem) {
    const confirmed = window.confirm(`Eliminar "${item.label}" del catálogo?`);
    if (!confirmed) return;

    try {
      const response = await fetch(`/api/cs/catalog-items/${item.id}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message || "No pudimos eliminar la tarea.");
      }

      setItems((current) => current.filter((currentItem) => currentItem.id !== item.id));
      if (editingId === item.id) {
        resetForm();
      }
      setFeedback({ tone: "success", message: "Tarea eliminada." });
    } catch (caughtError) {
      setFeedback({
        tone: "error",
        message: formatUserError(caughtError, "No pudimos eliminar la tarea."),
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
              <h1 className="text-2xl font-black text-slate-900">Gestión de tareas</h1>
            </div>
          </div>

          <p className="mt-4 text-sm text-slate-600">
            Aquí registras tareas base.
          </p>

          <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px_140px]">
              <div>
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Nombre de la tarea
                </label>
                <Input
                  value={form.label}
                  onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))}
                  placeholder="Sprint de Integridad de Datos"
                />
              </div>
              <div>
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Categoría
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
                  Créditos
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
                Tarea activa
              </label>

            </div>

            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={isSaving}>
                <Plus className="mr-2 h-4 w-4" />
                {isSaving ? "Guardando..." : editingId ? "Actualizar tarea" : "Crear tarea"}
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
              <h2 className="mt-1 text-xl font-black text-slate-900">Tareas registradas</h2>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
              {sortedItems.length} tareas
            </span>
          </div>

          <div className="mt-5 overflow-hidden rounded-[14px] border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                    Tarea
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                    Categoría
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                    En grupos
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                    Créditos
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
                {sortedItems.length ? (
                  sortedItems.map((item) => {
                    const itemGroups = memberships
                      .filter((membership) => membership.catalog_item_id === item.id)
                      .map((membership) => visibleGroupMap.get(membership.group_id)?.name)
                      .filter((groupName): groupName is string => Boolean(groupName));

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
                      Aún no hay tareas registradas.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <FeedbackToast feedback={feedback} onClose={() => setFeedback(null)} />
    </>
  );
}
