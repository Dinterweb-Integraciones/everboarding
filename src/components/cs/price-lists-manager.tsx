"use client";

import { Globe2, Info, Link2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { PriceListLinksModal } from "@/components/cs/price-list-links-modal";
import { FeedbackToast } from "@/components/ui/feedback-toast";
import { Input } from "@/components/ui/input";
import { SALES_CURRENCY_OPTIONS } from "@/lib/currency";
import { getClientCatalogCredits } from "@/lib/onboarding";
import type { PriceListLink } from "@/lib/price-list-links";
import {
  DEFAULT_PRICE_LIST_PACKAGE,
  applyPriceListToCredits,
  formatPriceListAdjustment,
  formatPriceListCountries,
  getCountryName,
  getCountryOptions,
  getPriceListAdjustmentLabel,
  getPriceListPackage,
  normalizePriceListAdjustmentType,
  toPriceListAdjustment,
  type PriceList,
  type PriceListAdjustmentType,
} from "@/lib/price-lists";
import { formatCurrency, formatUserError, safeParseNumber } from "@/lib/utils";

type PriceListRow = PriceList & { client_count: number };

type PriceListsManagerProps = {
  initialPriceLists: PriceListRow[];
  initialLinks: PriceListLink[];
};

type PriceListFormState = {
  name: string;
  description: string;
  countries: string[];
  adjustmentType: PriceListAdjustmentType;
  percentage: string;
  packageCredits: string;
  packagePrice: string;
  currency: string;
  isActive: boolean;
};

const fieldLabelClass = "mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500";
const selectClass =
  "h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20";

// Ícono "i" con la explicación en un globo: se ve al pasar el mouse, con el teclado o al tocarlo.
function InfoHint({ label, children }: { label: string; children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <span className="group relative inline-flex" onMouseLeave={() => setIsOpen(false)}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
        onBlur={() => setIsOpen(false)}
        className="grid h-5 w-5 place-items-center rounded-full text-slate-400 transition hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        <Info className="h-4 w-4" />
      </button>
      <span
        role="tooltip"
        className={`absolute left-1/2 top-full z-20 mt-2 w-[min(320px,80vw)] -translate-x-1/2 rounded-[10px] border border-slate-200 bg-white px-3 py-2 text-xs font-normal normal-case leading-relaxed tracking-normal text-slate-600 shadow-lg group-hover:block group-focus-within:block ${
          isOpen ? "block" : "hidden"
        }`}
      >
        {children}
      </span>
    </span>
  );
}

function createEmptyForm(): PriceListFormState {
  return {
    name: "",
    description: "",
    countries: [],
    adjustmentType: "discount",
    percentage: "10",
    packageCredits: String(DEFAULT_PRICE_LIST_PACKAGE.credits),
    packagePrice: String(DEFAULT_PRICE_LIST_PACKAGE.price),
    currency: DEFAULT_PRICE_LIST_PACKAGE.currency,
    isActive: true,
  };
}

export function PriceListsManager({ initialPriceLists, initialLinks }: PriceListsManagerProps) {
  const [priceLists, setPriceLists] = useState(initialPriceLists);
  const [links, setLinks] = useState(initialLinks);
  const [linksPriceListId, setLinksPriceListId] = useState<string | null>(null);
  const linksPriceList = priceLists.find((priceList) => priceList.id === linksPriceListId) ?? null;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PriceListFormState>(() => createEmptyForm());
  const [countryQuery, setCountryQuery] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(null);

  const countryOptions = useMemo(() => getCountryOptions(), []);
  const filteredCountryOptions = useMemo(() => {
    const query = countryQuery
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .trim();

    return countryOptions.filter((option) => {
      if (form.countries.includes(option.code)) return false;
      if (!query) return true;

      const name = option.name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      return name.includes(query) || option.code.toLowerCase() === query;
    });
  }, [countryOptions, countryQuery, form.countries]);

  // País -> otras listas activas que también lo incluyen. Un país puede tener varias listas: solo
  // se muestra como referencia.
  const countryOwners = useMemo(() => {
    const owners = new Map<string, string[]>();

    priceLists
      .filter((priceList) => priceList.is_active && priceList.id !== editingId)
      .forEach((priceList) =>
        priceList.countries.forEach((code) => owners.set(code, [...(owners.get(code) ?? []), priceList.name])),
      );

    return owners;
  }, [editingId, priceLists]);

  const sharedCountries = form.countries.filter((code) => countryOwners.has(code));

  const rows = useMemo(
    () =>
      [...priceLists].sort(
        (left, right) =>
          Number(right.is_active) - Number(left.is_active) || left.name.localeCompare(right.name, "es"),
      ),
    [priceLists],
  );

  function resetForm() {
    setEditingId(null);
    setForm(createEmptyForm());
    setCountryQuery("");
  }

  function startEdit(priceList: PriceListRow) {
    setEditingId(priceList.id);
    setForm({
      name: priceList.name,
      description: priceList.description ?? "",
      countries: priceList.countries,
      adjustmentType: priceList.adjustment_type,
      percentage: String(priceList.percentage),
      packageCredits: String(priceList.package_credits),
      packagePrice: String(priceList.package_price),
      currency: priceList.currency,
      isActive: priceList.is_active,
    });
    setCountryQuery("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function addCountry(code: string) {
    setForm((current) =>
      current.countries.includes(code)
        ? current
        : { ...current, countries: [...current.countries, code].sort() },
    );
    setCountryQuery("");
  }

  function removeCountry(code: string) {
    setForm((current) => ({
      ...current,
      countries: current.countries.filter((entry) => entry !== code),
    }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setFeedback(null);

    try {
      const response = await fetch(editingId ? `/api/cs/price-lists/${editingId}` : "/api/cs/price-lists", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          countries: form.countries,
          adjustmentType: form.adjustmentType,
          percentage: safeParseNumber(form.percentage),
          packageCredits: safeParseNumber(form.packageCredits),
          packagePrice: safeParseNumber(form.packagePrice),
          currency: form.currency,
          isActive: form.isActive,
        }),
      });
      const payload = (await response.json()) as PriceList & { message?: string };

      if (!response.ok) {
        throw new Error(payload.message || "No pudimos guardar la lista de precios.");
      }

      if (editingId) {
        setPriceLists((current) =>
          current.map((priceList) =>
            priceList.id === editingId ? { ...payload, client_count: priceList.client_count } : priceList,
          ),
        );
        setFeedback({ tone: "success", message: "Lista de precios actualizada." });
      } else {
        setPriceLists((current) => [...current, { ...payload, client_count: 0 }]);
        setFeedback({ tone: "success", message: "Lista de precios creada." });
      }

      resetForm();
    } catch (caughtError) {
      setFeedback({
        tone: "error",
        message: formatUserError(caughtError, "No pudimos guardar la lista de precios."),
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(priceList: PriceListRow) {
    if (!window.confirm(`¿Eliminar la lista "${priceList.name}"?`)) return;

    try {
      const response = await fetch(`/api/cs/price-lists/${priceList.id}`, { method: "DELETE" });
      const payload = (await response.json()) as { message?: string };

      if (!response.ok) {
        throw new Error(payload.message || "No pudimos eliminar la lista de precios.");
      }

      setPriceLists((current) => current.filter((item) => item.id !== priceList.id));
      // Los enlaces de la lista se borran con ella (on delete cascade).
      setLinks((current) => current.filter((link) => link.price_list_id !== priceList.id));
      if (editingId === priceList.id) resetForm();
      setFeedback({ tone: "success", message: "Lista de precios eliminada." });
    } catch (caughtError) {
      setFeedback({
        tone: "error",
        message: formatUserError(caughtError, "No pudimos eliminar la lista de precios."),
      });
    }
  }

  return (
    <>
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <section className="rounded-[18px] border border-slate-200 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.05)]">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-[var(--accent)]">
              <Globe2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Catálogo comercial</p>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-black text-slate-900">Listas de precios</h1>
                <InfoHint label="Cómo funcionan las listas de precios">
                  Define listas por país o región. Cada lista fija el paquete que se vende (créditos, precio base y
                  moneda) y, si quieres, un aumento o descuento porcentual sobre los créditos que cuesta cada caso de
                  uso (0% = sin ajuste). Un país puede estar en varias listas. El vendedor de Dinterweb elige la lista
                  en la propuesta y el cliente la hereda al activarse: amplía con su paquete, paga en su moneda y sus
                  casos de uso se le siguen cotizando con ella.
                </InfoHint>
              </div>
            </div>
          </div>

          <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <div>
                <label className={fieldLabelClass}>Nombre</label>
                <Input
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Centroamérica"
                />
              </div>

              <div>
                <label className={fieldLabelClass}>Tipo</label>
                <select
                  value={form.adjustmentType}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      adjustmentType: normalizePriceListAdjustmentType(event.target.value),
                    }))
                  }
                  className={selectClass}
                >
                  <option value="discount">Descuento</option>
                  <option value="increase">Aumento</option>
                </select>
              </div>

              <div>
                <label className={fieldLabelClass}>Porcentaje</label>
                <Input
                  type="number"
                  min={0}
                  max={form.adjustmentType === "discount" ? 99.99 : 100}
                  step="0.01"
                  value={form.percentage}
                  onChange={(event) => setForm((current) => ({ ...current, percentage: event.target.value }))}
                />
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <div>
                <label className={fieldLabelClass}>Créditos del paquete</label>
                <Input
                  type="number"
                  min={1}
                  step="1"
                  value={form.packageCredits}
                  onChange={(event) => setForm((current) => ({ ...current, packageCredits: event.target.value }))}
                />
              </div>

              <div>
                <label className={fieldLabelClass}>Precio base del paquete</label>
                <Input
                  type="number"
                  min={0.01}
                  step="0.01"
                  value={form.packagePrice}
                  onChange={(event) => setForm((current) => ({ ...current, packagePrice: event.target.value }))}
                />
              </div>

              <div>
                <label className={fieldLabelClass}>Moneda</label>
                <select
                  value={form.currency}
                  onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value }))}
                  className={selectClass}
                >
                  {SALES_CURRENCY_OPTIONS.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className={fieldLabelClass}>Descripción (opcional)</label>
              <Input
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="Precio regional para mercados de Centroamérica"
              />
            </div>

            <div>
              <label className={fieldLabelClass}>Países</label>
              <div className="rounded-[12px] border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-wrap gap-2">
                  {form.countries.length ? (
                    form.countries.map((code) => (
                      <span
                        key={code}
                        className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-700 shadow-[inset_0_0_0_1px_rgb(226,232,240)]"
                      >
                        {getCountryName(code)}
                        <button
                          type="button"
                          onClick={() => removeCountry(code)}
                          className="text-slate-400 transition hover:text-rose-600"
                          aria-label={`Quitar ${getCountryName(code)}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-slate-500">Aún no hay países en esta lista.</span>
                  )}
                </div>

                <Input
                  value={countryQuery}
                  onChange={(event) => setCountryQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && filteredCountryOptions[0]) {
                      event.preventDefault();
                      addCountry(filteredCountryOptions[0].code);
                    }
                  }}
                  placeholder="Buscar país para agregar"
                  className="mt-3"
                />

                {countryQuery.trim() ? (
                  <div className="mt-2 max-h-48 overflow-y-auto rounded-md border border-slate-200 bg-white">
                    {filteredCountryOptions.length ? (
                      filteredCountryOptions.slice(0, 30).map((option) => (
                        <button
                          key={option.code}
                          type="button"
                          onClick={() => addCountry(option.code)}
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50"
                        >
                          <span>{option.name}</span>
                          <span className="text-xs font-bold text-slate-400">
                            {countryOwners.has(option.code)
                              ? `También en ${countryOwners.get(option.code)?.join(", ")} · `
                              : ""}
                            {option.code}
                          </span>
                        </button>
                      ))
                    ) : (
                      <p className="px-3 py-2 text-sm text-slate-500">Sin coincidencias.</p>
                    )}
                  </div>
                ) : null}
              </div>

              {sharedCountries.length ? (
                <p className="mt-2 text-xs text-slate-500">
                  {sharedCountries
                    .map((code) => `${getCountryName(code)} también está en ${countryOwners.get(code)?.join(", ")}`)
                    .join(" · ")}
                  . El vendedor puede elegir cualquiera de ellas.
                </p>
              ) : null}
            </div>

            <div className="flex items-center gap-2 rounded-[12px] border border-slate-200 bg-slate-50 px-4 py-3">
              <label className="flex items-center gap-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300 text-[var(--accent)] focus:ring-[var(--accent)]"
                />
                Lista disponible para ventas
              </label>
              <InfoHint label="Qué pasa al desactivar la lista">
                Desactivarla la oculta en propuestas nuevas; los clientes que ya la tienen la siguen usando.
              </InfoHint>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={isSaving}>
                <Plus className="mr-2 h-4 w-4" />
                {isSaving ? "Guardando..." : editingId ? "Actualizar lista" : "Crear lista"}
              </Button>
              <Button type="button" variant="secondary" onClick={resetForm} disabled={isSaving}>
                {editingId ? "Cancelar edición" : "Limpiar"}
              </Button>
            </div>
          </form>
        </section>

        <section className="mt-6 rounded-[18px] border border-slate-200 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.05)]">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-black text-slate-900">Listas registradas</h2>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
              {rows.length} listas
            </span>
          </div>

          <div className="mt-5 overflow-x-auto rounded-[14px] border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  {["Lista", "Países", "Paquete", "Ajuste de créditos", "Clientes", "Estado"].map((heading) => (
                    <th
                      key={heading}
                      className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500"
                    >
                      {heading}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {rows.length ? (
                  rows.map((priceList) => {
                    const adjustment = toPriceListAdjustment(priceList);
                    const pricePackage = getPriceListPackage(priceList);
                    const hasAdjustment = adjustment.percentage > 0;

                    return (
                      <tr key={priceList.id}>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-slate-800">{priceList.name}</p>
                          {priceList.description ? (
                            <p className="mt-0.5 text-xs text-slate-500">{priceList.description}</p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-slate-600" title={formatPriceListCountries(priceList.countries, 999)}>
                          {formatPriceListCountries(priceList.countries)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                          <p className="font-semibold text-slate-800">{pricePackage.credits} CR</p>
                          <p className="text-xs text-slate-500">
                            {formatCurrency(pricePackage.price, pricePackage.currency.toUpperCase())}{" "}
                            {pricePackage.currency.toUpperCase()}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${
                              !hasAdjustment
                                ? "bg-slate-100 text-slate-500"
                                : priceList.adjustment_type === "discount"
                                  ? "bg-sky-100 text-sky-700"
                                  : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {hasAdjustment
                              ? `${getPriceListAdjustmentLabel(adjustment)} ${formatPriceListAdjustment(adjustment)}`
                              : formatPriceListAdjustment(adjustment)}
                          </span>
                          {hasAdjustment ? (
                            <p className="mt-1 whitespace-nowrap text-xs text-slate-500">
                              Caso de 10 CR: {applyPriceListToCredits(10, adjustment)} CR · paquete{" "}
                              {getClientCatalogCredits(applyPriceListToCredits(10, adjustment), true)} CR
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-slate-600">{priceList.client_count}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${
                              priceList.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            {priceList.is_active ? "Activa" : "Inactiva"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <Button type="button" variant="ghost" onClick={() => setLinksPriceListId(priceList.id)}>
                              <Link2 className="mr-2 h-4 w-4" />
                              Enlaces
                              {links.some((link) => link.price_list_id === priceList.id)
                                ? ` (${links.filter((link) => link.price_list_id === priceList.id).length})`
                                : ""}
                            </Button>
                            <Button type="button" variant="ghost" onClick={() => startEdit(priceList)}>
                              <Pencil className="mr-2 h-4 w-4" />
                              Editar
                            </Button>
                            <Button type="button" variant="ghost" onClick={() => void handleDelete(priceList)}>
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
                    <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                      Aún no hay listas de precios. Mientras tanto los casos de uso se cotizan con los créditos base del catálogo.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {linksPriceList ? (
        <PriceListLinksModal
          priceListId={linksPriceList.id}
          priceListName={linksPriceList.name}
          priceListIsActive={linksPriceList.is_active}
          links={links.filter((link) => link.price_list_id === linksPriceList.id)}
          onLinksChange={setLinks}
          onFeedback={setFeedback}
          onClose={() => setLinksPriceListId(null)}
        />
      ) : null}

      <FeedbackToast feedback={feedback} onClose={() => setFeedback(null)} />
    </>
  );
}
