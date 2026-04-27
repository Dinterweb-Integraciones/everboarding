"use client";

import { FolderTree, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { FeedbackToast } from "@/components/ui/feedback-toast";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { CreditCatalogCategory, CreditCatalogItem } from "@/lib/onboarding";
import { formatUserError } from "@/lib/utils";

type CatalogCategoriesManagerProps = {
  initialCategories: CreditCatalogCategory[];
  initialItems: CreditCatalogItem[];
};

const emptyForm = {
  name: "",
  description: "",
  isActive: true,
};

export function CatalogCategoriesManager({
  initialCategories,
  initialItems,
}: CatalogCategoriesManagerProps) {
  const [categories, setCategories] = useState(initialCategories);
  const [items] = useState(initialItems);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);

  const rows = useMemo(
    () =>
      [...categories]
        .sort((left, right) => left.name.localeCompare(right.name, "es"))
        .map((category) => ({
          ...category,
          taskCount: items.filter((item) => item.category === category.name).length,
        })),
    [categories, items],
  );

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
  }

  function startEdit(category: CreditCatalogCategory) {
    setEditingId(category.id);
    setForm({
      name: category.name,
      description: category.description ?? "",
      isActive: category.is_active,
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setFeedback(null);

    try {
      const response = await fetch(
        editingId ? `/api/cs/catalog-categories/${editingId}` : "/api/cs/catalog-categories",
        {
          method: editingId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name,
            description: form.description,
            isActive: form.isActive,
          }),
        },
      );

      const payload = (await response.json()) as CreditCatalogCategory & { message?: string };
      if (!response.ok) {
        throw new Error(payload.message || "No pudimos guardar la categoría.");
      }

      if (editingId) {
        setCategories((current) =>
          current.map((category) => (category.id === editingId ? { ...category, ...payload } : category)),
        );
        setFeedback({ tone: "success", message: "Categoría actualizada." });
      } else {
        setCategories((current) => [...current, payload]);
        setFeedback({ tone: "success", message: "Categoría creada." });
      }

      resetForm();
    } catch (caughtError) {
      setFeedback({
        tone: "error",
        message: formatUserError(caughtError, "No pudimos guardar la categoría."),
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(category: CreditCatalogCategory) {
    const confirmed = window.confirm(`Eliminar "${category.name}" del catálogo de categorías?`);
    if (!confirmed) return;

    try {
      const response = await fetch(`/api/cs/catalog-categories/${category.id}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message || "No pudimos eliminar la categoría.");
      }

      setCategories((current) => current.filter((item) => item.id !== category.id));
      if (editingId === category.id) {
        resetForm();
      }
      setFeedback({ tone: "success", message: "Categoría eliminada." });
    } catch (caughtError) {
      setFeedback({
        tone: "error",
        message: formatUserError(caughtError, "No pudimos eliminar la categoría."),
      });
    }
  }

  return (
    <>
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <section className="rounded-[18px] border border-slate-200 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.05)]">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-[var(--accent)]">
              <FolderTree className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                CRUD CS
              </p>
              <h1 className="text-2xl font-black text-slate-900">Gestión de categorías</h1>
            </div>
          </div>

          <p className="mt-4 text-sm text-slate-600">
            Aquí administras los tipos o clasificaciones de las tareas del catálogo.
          </p>

          <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Nombre de la categoría
                </label>
                <Input
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Integraciones y Datos"
                />
              </div>

              <label className="flex items-center gap-3 rounded-[12px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 lg:mt-7">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300 text-[var(--accent)] focus:ring-[var(--accent)]"
                />
                Categoría activa
              </label>
            </div>

            <div>
              <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                Descripción
              </label>
              <Textarea
                rows={3}
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="Describe qué tipo de tareas agrupa esta categoría."
              />
            </div>

            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={isSaving}>
                <Plus className="mr-2 h-4 w-4" />
                {isSaving ? "Guardando..." : editingId ? "Actualizar categoría" : "Crear categoría"}
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
              <h2 className="mt-1 text-xl font-black text-slate-900">Categorías registradas</h2>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
              {rows.length} categorías
            </span>
          </div>

          <div className="mt-5 overflow-hidden rounded-[14px] border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                    Categoría
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                    Descripción
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                    Tareas
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
                {rows.length ? (
                  rows.map((category) => (
                    <tr key={category.id}>
                      <td className="px-4 py-4 font-semibold text-slate-900">{category.name}</td>
                      <td className="px-4 py-4 text-slate-600">{category.description || "Sin descripción"}</td>
                      <td className="px-4 py-4 text-slate-600">{category.taskCount} tareas</td>
                      <td className="px-4 py-4">
                        <span
                          className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                            category.is_active
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-slate-200 text-slate-600"
                          }`}
                        >
                          {category.is_active ? "Activa" : "Inactiva"}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex justify-end gap-2">
                          <Button type="button" variant="secondary" onClick={() => startEdit(category)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Editar
                          </Button>
                          <Button type="button" variant="danger" onClick={() => handleDelete(category)}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            Eliminar
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                      Aún no hay categorías registradas.
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
