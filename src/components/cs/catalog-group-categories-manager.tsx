"use client";

import { FolderTree, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { FeedbackToast } from "@/components/ui/feedback-toast";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { CreditCatalogGroupCategory, CreditCatalogGroupCategoryLink } from "@/lib/onboarding";
import { formatUserError, safeParseNumber } from "@/lib/utils";

type CatalogGroupCategoriesManagerProps = {
  initialCategories: CreditCatalogGroupCategory[];
  initialCategoryLinks: CreditCatalogGroupCategoryLink[];
};

type CatalogGroupCategoryForm = {
  name: string;
  description: string;
  sortOrder: string;
  isActive: boolean;
};

const emptyForm: CatalogGroupCategoryForm = {
  name: "",
  description: "",
  sortOrder: "0",
  isActive: true,
};

export function CatalogGroupCategoriesManager({
  initialCategories,
  initialCategoryLinks,
}: CatalogGroupCategoriesManagerProps) {
  const [categories, setCategories] = useState(initialCategories);
  const [categoryLinks] = useState(initialCategoryLinks);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CatalogGroupCategoryForm>(emptyForm);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);

  const rows = useMemo(
    () =>
      [...categories]
        .sort(
          (left, right) =>
            safeParseNumber(left.sort_order) - safeParseNumber(right.sort_order)
            || left.name.localeCompare(right.name, "es"),
        )
        .map((category) => ({
          ...category,
          groupCount: new Set(
            categoryLinks
              .filter((link) => link.category_id === category.id)
              .map((link) => link.group_id),
          ).size,
        })),
    [categories, categoryLinks],
  );

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
  }

  function startEdit(category: CreditCatalogGroupCategory) {
    setEditingId(category.id);
    setForm({
      name: category.name,
      description: category.description ?? "",
      sortOrder: String(category.sort_order ?? 0),
      isActive: category.is_active,
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setFeedback(null);

    try {
      const response = await fetch(
        editingId
          ? `/api/cs/catalog-group-categories/${editingId}`
          : "/api/cs/catalog-group-categories",
        {
          method: editingId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name,
            description: form.description,
            sortOrder: safeParseNumber(form.sortOrder),
            isActive: form.isActive,
          }),
        },
      );

      const payload = (await response.json()) as CreditCatalogGroupCategory & { message?: string };
      if (!response.ok) {
        throw new Error(payload.message || "No pudimos guardar la categoria de grupo.");
      }

      if (editingId) {
        setCategories((current) =>
          current.map((category) => (category.id === editingId ? { ...category, ...payload } : category)),
        );
        setFeedback({ tone: "success", message: "Categoria de grupo actualizada." });
      } else {
        setCategories((current) => [...current, payload]);
        setFeedback({ tone: "success", message: "Categoria de grupo creada." });
      }

      resetForm();
    } catch (caughtError) {
      setFeedback({
        tone: "error",
        message: formatUserError(caughtError, "No pudimos guardar la categoria de grupo."),
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(category: CreditCatalogGroupCategory) {
    const confirmed = window.confirm(`Eliminar "${category.name}" del catalogo de categorias de grupos?`);
    if (!confirmed) return;

    try {
      const response = await fetch(`/api/cs/catalog-group-categories/${category.id}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message || "No pudimos eliminar la categoria de grupo.");
      }

      setCategories((current) => current.filter((item) => item.id !== category.id));
      if (editingId === category.id) {
        resetForm();
      }
      setFeedback({ tone: "success", message: "Categoria de grupo eliminada." });
    } catch (caughtError) {
      setFeedback({
        tone: "error",
        message: formatUserError(caughtError, "No pudimos eliminar la categoria de grupo."),
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
              <h1 className="text-2xl font-black text-slate-900">Categorias de grupos</h1>
            </div>
          </div>

          <p className="mt-4 text-sm text-slate-600">
            Aqui administras las categorias visuales de los grupos y el orden en que deben mostrarse.
          </p>

          <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_180px]">
              <div>
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Nombre de la categoria
                </label>
                <Input
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Fundamentales"
                />
              </div>

              <div>
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Orden visual
                </label>
                <Input
                  type="number"
                  value={form.sortOrder}
                  onChange={(event) => setForm((current) => ({ ...current, sortOrder: event.target.value }))}
                  placeholder="0"
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                Descripcion
              </label>
              <Textarea
                rows={3}
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="Describe como debe agruparse y presentarse esta categoria."
              />
            </div>

            <label className="flex items-center gap-3 rounded-[12px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))}
                className="h-4 w-4 rounded border-slate-300 text-[var(--accent)] focus:ring-[var(--accent)]"
              />
              Categoria activa
            </label>

            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={isSaving}>
                <Plus className="mr-2 h-4 w-4" />
                {isSaving ? "Guardando..." : editingId ? "Actualizar categoria" : "Crear categoria"}
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
              <h2 className="mt-1 text-xl font-black text-slate-900">Categorias registradas</h2>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
              {rows.length} categorias
            </span>
          </div>

          <div className="mt-5 overflow-hidden rounded-[14px] border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                    Categoria
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                    Descripcion
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                    Orden
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                    Grupos
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
                      <td className="px-4 py-4 text-slate-600">{category.description || "Sin descripcion"}</td>
                      <td className="px-4 py-4 text-slate-600">{safeParseNumber(category.sort_order)}</td>
                      <td className="px-4 py-4 text-slate-600">{category.groupCount} grupos</td>
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
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                      Aun no hay categorias de grupos registradas.
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
