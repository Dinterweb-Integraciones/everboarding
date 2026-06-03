"use client";

import Link from "next/link";
import { BanknoteArrowDown, CheckCircle2, ExternalLink, Save } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { FeedbackToast } from "@/components/ui/feedback-toast";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { FinanceTransferPaymentItem } from "@/lib/finance-transfer-payments";
import { formatCurrency, formatDate, formatUserError } from "@/lib/utils";

type FinanceTransferPaymentsManagerProps = {
  initialItems: FinanceTransferPaymentItem[];
};

export function FinanceTransferPaymentsManager({
  initialItems,
}: FinanceTransferPaymentsManagerProps) {
  const [items, setItems] = useState(initialItems);
  const [draftBanks, setDraftBanks] = useState<Record<string, string>>(
    Object.fromEntries(initialItems.map((item) => [item.id, item.transferBank || ""])),
  );
  const [draftReferences, setDraftReferences] = useState<Record<string, string>>(
    Object.fromEntries(initialItems.map((item) => [item.id, item.transferReference || ""])),
  );
  const [confirmedCount, setConfirmedCount] = useState(0);
  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);

  const sortedItems = useMemo(
    () =>
      [...items].sort(
        (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
      ),
    [items],
  );

  async function confirmTransferPayment(item: FinanceTransferPaymentItem) {
    const transferBank = draftBanks[item.id]?.trim() ?? "";
    const transferReference = draftReferences[item.id]?.trim() ?? "";
    if (!transferBank) {
      setFeedback({
        tone: "error",
        message: "Ingresa el banco antes de confirmar el pago.",
      });
      return;
    }

    if (!transferReference) {
      setFeedback({
        tone: "error",
        message: "Ingresa la referencia bancaria antes de confirmar el pago.",
      });
      return;
    }

    setSavingItemId(item.id);
    setFeedback(null);

    try {
      const endpoint =
        item.kind === "initial"
          ? `/api/finance/sales-proposals/${item.proposalId}/confirm-transfer`
          : `/api/finance/sales-proposals/${item.proposalId}/confirm-transfer-renewal`;
      const response = await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transferBank,
          transferReference,
          cycleStartDate: item.kind === "renewal" ? item.cycleStartDate : undefined,
        }),
      });
      const payload = (await response.json()) as { message?: string; assignedCsmUserId?: string };

      if (!response.ok) {
        throw new Error(payload.message || "No pudimos confirmar la transferencia.");
      }

      setItems((current) => current.filter((currentItem) => currentItem.id !== item.id));
      setConfirmedCount((current) => current + 1);
      setFeedback({
        tone: "success",
        message:
          item.kind === "renewal"
            ? "Pago confirmado. Se recargaron los creditos del nuevo periodo."
            : payload.assignedCsmUserId
              ? "Pago confirmado. La venta volvio al flujo y ya puede activarse con su CS asignado."
              : "Pago confirmado. La venta ya puede volver al flujo comercial para asignar CS.",
      });
    } catch (caughtError) {
      setFeedback({
        tone: "error",
        message: formatUserError(caughtError, "No pudimos confirmar la transferencia."),
      });
    } finally {
      setSavingItemId(null);
    }
  }

  return (
    <>
      <div className="mx-auto w-full max-w-none px-3 py-8 sm:px-4 lg:px-6 xl:px-8">
        <section className="rounded-[18px] border border-slate-200 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.05)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-[var(--accent)]">
                <BanknoteArrowDown className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                  Finanzas
                </p>
                <h1 className="text-2xl font-black text-slate-900">
                  Cobros por transferencia pendientes
                </h1>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">
                {sortedItems.length} pendientes
              </span>
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">
                {confirmedCount} confirmadas
              </span>
            </div>
          </div>

          <p className="mt-4 max-w-3xl text-sm text-slate-600">
            Aqui validas activaciones iniciales y renovaciones de suscripciones cobradas por
            transferencia. Al confirmar una renovacion, los creditos del nuevo periodo se cargan
            inmediatamente.
          </p>
        </section>

        <section className="mt-6">
          {sortedItems.length ? (
            <div className="overflow-hidden rounded-[18px] border border-slate-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.05)]">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                        Empresa
                      </th>
                      <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                        Tipo
                      </th>
                      <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                        Vendedor
                      </th>
                      <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                        Inversion
                      </th>
                      <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                        Periodo
                      </th>
                      <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                        Vence
                      </th>
                      <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                        Banco y referencia
                      </th>
                      <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                        Acciones
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {sortedItems.map((item) => {
                      return (
                        <tr key={item.id} className="align-top">
                          <td className="px-4 py-4">
                            <div className="min-w-[220px]">
                              <p className="font-bold text-slate-900">
                                {item.clientCompany || item.clientName || "Cliente sin nombre"}
                              </p>
                              <p className="mt-1 text-sm text-slate-600">{item.title}</p>
                              <p className="mt-2 text-sm text-slate-500">
                                {item.clientName || "--"} · {item.clientEmail || "Sin email"}
                              </p>
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <div className="min-w-[110px]">
                              <span
                                className={
                                  item.kind === "renewal"
                                    ? "inline-flex rounded-full bg-sky-100 px-3 py-1 text-[11px] font-bold text-sky-800"
                                    : "inline-flex rounded-full bg-amber-100 px-3 py-1 text-[11px] font-bold text-amber-800"
                                }
                              >
                                {item.kind === "renewal" ? "Renovacion" : "Inicial"}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-sm font-semibold text-slate-800">
                            {item.sellerName || item.sellerEmail || "--"}
                          </td>
                          <td className="px-4 py-4 text-sm font-semibold text-slate-800">
                            {formatCurrency(item.amount, item.currency.toUpperCase())}
                          </td>
                          <td className="px-4 py-4">
                            <div className="min-w-[210px] text-sm font-semibold text-slate-800">
                              <p>
                                {formatDate(item.cycleStartDate)} - {formatDate(item.cycleEndDate)}
                              </p>
                              <p className="mt-1 text-xs font-medium text-slate-500">
                                {item.contractedCredits} CR · cada{" "}
                                {item.periodMonths === 1 ? "mes" : `${item.periodMonths} meses`}
                              </p>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-sm font-semibold text-slate-800">
                            {formatDate(item.dueDate)}
                          </td>
                          <td className="px-4 py-4">
                            <div className="min-w-[220px] space-y-2">
                              <Select
                                value={draftBanks[item.id] ?? ""}
                                onChange={(event) =>
                                  setDraftBanks((current) => ({
                                    ...current,
                                    [item.id]: event.target.value,
                                  }))
                                }
                              >
                                <option value="" disabled hidden>
                                  Elige el banco
                                </option>
                                <option value="BanColombia">BanColombia</option>
                                <option value="BBVA">BBVA</option>
                                <option value="BAC">BAC</option>
                                <option value="Stripe México">Stripe México</option>
                              </Select>
                              <Input
                                value={draftReferences[item.id] ?? ""}
                                onChange={(event) =>
                                  setDraftReferences((current) => ({
                                    ...current,
                                    [item.id]: event.target.value,
                                  }))
                                }
                                placeholder="Referencia bancaria"
                              />
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                onClick={() => confirmTransferPayment(item)}
                                disabled={savingItemId === item.id}
                              >
                                {savingItemId === item.id ? (
                                  <Save className="mr-2 h-4 w-4" />
                                ) : (
                                  <CheckCircle2 className="mr-2 h-4 w-4" />
                                )}
                                {savingItemId === item.id ? "Confirmando..." : "Confirmar pago"}
                              </Button>
                              {item.slug ? (
                                <Link
                                  href={
                                    item.workspaceVariant === "dinterweb"
                                      ? `/sales/dinterweb/proposals/${item.slug}`
                                      : `/sales/proposals/${item.slug}`
                                  }
                                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                                >
                                  Ver
                                  <ExternalLink className="h-4 w-4" />
                                </Link>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="rounded-[18px] border border-slate-200 bg-white px-6 py-12 text-center shadow-[0_18px_50px_rgba(15,23,42,0.05)]">
              <p className="text-lg font-bold text-slate-900">
                No hay cobros por transferencia pendientes.
              </p>
              <p className="mt-2 text-sm text-slate-500">
                Cuando una venta o renovacion por transferencia necesite validacion, aparecera aqui.
              </p>
            </div>
          )}
        </section>
      </div>

      <FeedbackToast feedback={feedback} onClose={() => setFeedback(null)} />
    </>
  );
}
