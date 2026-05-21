"use client";

import { BadgePercent, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { normalizeCouponPercentageOff, normalizeSalesCouponType, type SalesCouponType } from "@/lib/sales-proposals";
import { formatCurrency, formatUserError, safeParseNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FeedbackToast } from "@/components/ui/feedback-toast";
import { Input } from "@/components/ui/input";
import type { Database } from "@/types/database";

type SalesCoupon = Database["public"]["Tables"]["sales_coupons"]["Row"];

type SalesCouponsManagerProps = {
  initialCoupons: SalesCoupon[];
};

const emptyForm = {
  code: "",
  couponType: "package_override" as SalesCouponType,
  grantedCredits: "60",
  discountedPrice: "852",
  percentageOff: "20",
  isActive: true,
};

function getCouponTypeLabel(couponType: string | null | undefined) {
  return normalizeSalesCouponType(couponType) === "percentage" ? "Descuento %" : "Paquete";
}

function getCouponBenefitLabel(coupon: SalesCoupon) {
  const couponType = normalizeSalesCouponType(coupon.coupon_type);

  if (couponType === "percentage") {
    return `${normalizeCouponPercentageOff(coupon.percentage_off)}% sobre el precio actual`;
  }

  return `${coupon.granted_credits} CR por ${formatCurrency(Number(coupon.discounted_price ?? 0))}`;
}

export function SalesCouponsManager({ initialCoupons }: SalesCouponsManagerProps) {
  const [coupons, setCoupons] = useState(initialCoupons);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);

  const rows = useMemo(
    () =>
      [...coupons].sort(
        (left, right) =>
          left.code.localeCompare(right.code, "es") ||
          String(right.created_at).localeCompare(String(left.created_at)),
      ),
    [coupons],
  );

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
  }

  function startEdit(coupon: SalesCoupon) {
    setEditingId(coupon.id);
    setForm({
      code: coupon.code,
      couponType: normalizeSalesCouponType(coupon.coupon_type),
      grantedCredits: String(coupon.granted_credits ?? 0),
      discountedPrice: String(coupon.discounted_price ?? 0),
      percentageOff: String(normalizeCouponPercentageOff(coupon.percentage_off)),
      isActive: coupon.is_active,
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setFeedback(null);

    try {
      const response = await fetch(
        editingId ? `/api/cs/sales-coupons/${editingId}` : "/api/cs/sales-coupons",
        {
          method: editingId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: form.code,
            couponType: form.couponType,
            grantedCredits: Math.max(0, Math.round(safeParseNumber(form.grantedCredits))),
            discountedPrice: Math.max(0, safeParseNumber(form.discountedPrice)),
            percentageOff: Math.max(0, normalizeCouponPercentageOff(form.percentageOff)),
            isActive: form.isActive,
          }),
        },
      );

      const payload = (await response.json()) as SalesCoupon & { message?: string };
      if (!response.ok) {
        throw new Error(payload.message || "No pudimos guardar el cupon.");
      }

      if (editingId) {
        setCoupons((current) =>
          current.map((coupon) => (coupon.id === editingId ? { ...coupon, ...payload } : coupon)),
        );
        setFeedback({ tone: "success", message: "Cupon actualizado." });
      } else {
        setCoupons((current) => [...current, payload]);
        setFeedback({ tone: "success", message: "Cupon creado." });
      }

      resetForm();
    } catch (caughtError) {
      setFeedback({
        tone: "error",
        message: formatUserError(caughtError, "No pudimos guardar el cupon."),
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(coupon: SalesCoupon) {
    const confirmed = window.confirm(`Eliminar el cupon "${coupon.code}"?`);
    if (!confirmed) return;

    try {
      const response = await fetch(`/api/cs/sales-coupons/${coupon.id}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message || "No pudimos eliminar el cupon.");
      }

      setCoupons((current) => current.filter((item) => item.id !== coupon.id));
      if (editingId === coupon.id) {
        resetForm();
      }
      setFeedback({ tone: "success", message: "Cupon eliminado." });
    } catch (caughtError) {
      setFeedback({
        tone: "error",
        message: formatUserError(caughtError, "No pudimos eliminar el cupon."),
      });
    }
  }

  return (
    <>
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <section className="rounded-[18px] border border-slate-200 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.05)]">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-[var(--accent)]">
              <BadgePercent className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                CRUD CS
              </p>
              <h1 className="text-2xl font-black text-slate-900">Gestion de cupones</h1>
            </div>
          </div>

          <p className="mt-4 text-sm text-slate-600">
            Aqui defines cupones comerciales de paquete cerrado o porcentaje de descuento para que ventas los aplique sin rehacer la propuesta.
          </p>

          <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
            <div className="grid gap-4 lg:grid-cols-4">
              <div>
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Codigo
                </label>
                <Input
                  value={form.code}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))
                  }
                  placeholder="DTEXTIL20"
                />
              </div>

              <div>
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Tipo
                </label>
                <select
                  value={form.couponType}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      couponType: normalizeSalesCouponType(event.target.value),
                    }))
                  }
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
                >
                  <option value="package_override">Paquete cerrado</option>
                  <option value="percentage">Descuento porcentual</option>
                </select>
              </div>

              {form.couponType === "package_override" ? (
                <>
                  <div>
                    <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                      Creditos
                    </label>
                    <Input
                      type="number"
                      min={1}
                      value={form.grantedCredits}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, grantedCredits: event.target.value }))
                      }
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                      Precio final
                    </label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={form.discountedPrice}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, discountedPrice: event.target.value }))
                      }
                    />
                  </div>
                </>
              ) : (
                <div>
                  <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                    Descuento %
                  </label>
                  <Input
                    type="number"
                    min={0.01}
                    max={100}
                    step="0.01"
                    value={form.percentageOff}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, percentageOff: event.target.value }))
                    }
                  />
                </div>
              )}
            </div>

            <div className="rounded-[12px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              {form.couponType === "package_override"
                ? "Este cupon reemplaza el paquete comercial actual por una combinacion fija de creditos y precio final."
                : "Este cupon conserva el board y los creditos ya armados, y solo recalcula el precio con el porcentaje indicado."}
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
                Cupon activo para ventas
              </label>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={isSaving}>
                <Plus className="mr-2 h-4 w-4" />
                {isSaving ? "Guardando..." : editingId ? "Actualizar cupon" : "Crear cupon"}
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
              <h2 className="mt-1 text-xl font-black text-slate-900">Cupones registrados</h2>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
              {rows.length} cupones
            </span>
          </div>

          <div className="mt-5 overflow-hidden rounded-[14px] border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                    Codigo
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                    Tipo
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                    Beneficio
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
                {rows.map((coupon) => (
                  <tr key={coupon.id}>
                    <td className="px-4 py-3 font-semibold text-slate-800">{coupon.code}</td>
                    <td className="px-4 py-3 text-slate-600">{getCouponTypeLabel(coupon.coupon_type)}</td>
                    <td className="px-4 py-3 text-slate-600">{getCouponBenefitLabel(coupon)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${
                          coupon.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {coupon.is_active ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Button type="button" variant="ghost" onClick={() => startEdit(coupon)}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Editar
                        </Button>
                        <Button type="button" variant="ghost" onClick={() => void handleDelete(coupon)}>
                          <Trash2 className="mr-2 h-4 w-4" />
                          Eliminar
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <FeedbackToast feedback={feedback} onClose={() => setFeedback(null)} />
    </>
  );
}
