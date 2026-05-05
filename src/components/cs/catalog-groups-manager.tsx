"use client";

import { Layers3, Pencil, Plus, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { FeedbackToast } from "@/components/ui/feedback-toast";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { CreditCatalogGroup, CreditCatalogGroupItem, CreditCatalogItem } from "@/lib/onboarding";
import { formatUserError, safeParseNumber } from "@/lib/utils";

type CatalogGroupsManagerProps = {
  initialGroups: CreditCatalogGroup[];
  initialItems: CreditCatalogItem[];
  initialMemberships: CreditCatalogGroupItem[];
};

type CatalogGroupForm = {
  name: string;
  description: string;
  modalCategory: string;
  credits: string;
  sortOrder: string;
  isActive: boolean;
};

const emptyForm: CatalogGroupForm = {
  name: "",
  description: "",
  modalCategory: "",
  credits: "0",
  sortOrder: "0",
  isActive: true,
};

export function CatalogGroupsManager({
  initialGroups,
  initialItems,
  initialMemberships,
}: CatalogGroupsManagerProps) {
  const [groups, setGroups] = useState(initialGroups);
  const [items] = useState(initialItems);
  const [memberships, setMemberships] = useState(initialMemberships);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CatalogGroupForm>(emptyForm);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [taskToAdd, setTaskToAdd] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);

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
        const taskIds = memberships
          .filter((membership) => membership.group_id === group.id)
          .sort((left, right) => safeParseNumber(left.sort_order) - safeParseNumber(right.sort_order))
          .map((membership) => membership.catalog_item_id);

        const groupTasks = taskIds
          .map((taskId) => items.find((item) => item.id === taskId))
          .filter((item): item is CreditCatalogItem => Boolean(item));

        return {
          ...group,
          modalCategory: group.modal_category ?? "",
          taskCount: groupTasks.length,
          totalCredits: groupTasks.length
            ? groupTasks.reduce((sum, item) => sum + safeParseNumber(item.credits), 0)
            : safeParseNumber(group.credits),
          taskNames: groupTasks.map((item) => item.label),
          taskCategories: [...new Set(groupTasks.map((item) => item.category))],
        };
      }),
    [items, memberships, sortedGroups],
  );

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
    setSelectedTaskIds([]);
    setTaskToAdd("");
  }

  function startEdit(group: CreditCatalogGroup) {
    setEditingId(group.id);
    setForm({
      name: group.name,
      description: group.description ?? "",
      modalCategory: group.modal_category ?? "",
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
  }

  function attachTaskToDraft() {
    if (!taskToAdd || selectedTaskIds.includes(taskToAdd)) return;
    setSelectedTaskIds((current) => [...current, taskToAdd]);
    setTaskToAdd("");
  }

  function detachTaskFromDraft(taskId: string) {
    setSelectedTaskIds((current) => current.filter((currentId) => currentId !== taskId));
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
            modalCategory: form.modalCategory,
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

      if (editingId) {
        setGroups((current) =>
          current.map((group) => (group.id === editingId ? { ...group, ...payload } : group)),
        );
        setMemberships((current) => [
          ...current.filter((membership) => membership.group_id !== editingId),
          ...nextMemberships,
        ]);
        setFeedback({ tone: "success", message: "Grupo actualizado." });
      } else {
        setGroups((current) => [...current, payload]);
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
      setMemberships((current) => current.filter((membership) => membership.group_id !== group.id));
      if (editingId === group.id) {
        resetForm();
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

            <div>
              <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                Categoria visible en guía inteligente
              </label>
              <Input
                value={form.modalCategory ?? ""}
                onChange={(event) =>
                  setForm((current) => ({ ...current, modalCategory: event.target.value }))
                }
                placeholder="Sales, Marketing, Service, IA..."
              />
              <p className="mt-2 text-xs text-slate-500">
                Este valor define en qué pestaña del modal comercial aparecerá el grupo.
              </p>
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
              {groupsTableRows.length} grupos
            </span>
          </div>

          <div className="mt-5 overflow-hidden rounded-[14px] border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                    Grupo
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                    Descripcion
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                    Creditos
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                    Categoria modal
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                    Categorias mezcladas
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                    Tareas que lo componen
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
                {groupsTableRows.length ? (
                  groupsTableRows.map((group) => (
                    <tr key={group.id}>
                      <td className="px-4 py-4">
                        <div className="font-semibold text-slate-900">{group.name}</div>
                        <div className="text-xs text-slate-500">{group.taskCount} tareas</div>
                      </td>
                      <td className="px-4 py-4 text-slate-600">
                        {group.description || "Sin descripcion"}
                      </td>
                      <td className="px-4 py-4 text-slate-600">{group.totalCredits} CR</td>
                      <td className="px-4 py-4 text-slate-600">
                        {group.modalCategory || "Sin categoria"}
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap gap-2">
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
                            <span className="text-slate-400">Sin categorias</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap gap-2">
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
                            <span className="text-slate-400">Sin tareas</span>
                          )}
                        </div>
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
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                      Aun no hay grupos registrados.
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
