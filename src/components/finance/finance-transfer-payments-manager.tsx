"use client";

import Link from "next/link";
import { BanknoteArrowDown, CheckCircle2, ExternalLink, Save } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { FeedbackToast } from "@/components/ui/feedback-toast";
import { Input } from "@/components/ui/input";
import type { SalesProposalRecord } from "@/lib/sales-proposals";
import { formatCurrency, formatDate, formatUserError } from "@/lib/utils";

type FinanceTransferPaymentsManagerProps = {
  initialProposals: SalesProposalRecord[];
};

export function FinanceTransferPaymentsManager({
  initialProposals,
}: FinanceTransferPaymentsManagerProps) {
  const [proposals, setProposals] = useState(initialProposals);
  const [draftReferences, setDraftReferences] = useState<Record<string, string>>(
    Object.fromEntries(
      initialProposals.map((proposal) => [proposal.id ?? proposal.slug ?? "", proposal.transferReference || ""]),
    ),
  );
  const [confirmedCount, setConfirmedCount] = useState(0);
  const [savingProposalId, setSavingProposalId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);

  const sortedProposals = useMemo(
    () =>
      [...proposals].sort(
        (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
      ),
    [proposals],
  );

  async function confirmTransferPayment(proposalId: string) {
    const transferReference = draftReferences[proposalId]?.trim() ?? "";
    if (!transferReference) {
      setFeedback({
        tone: "error",
        message: "Ingresa la referencia bancaria antes de confirmar el pago.",
      });
      return;
    }

    setSavingProposalId(proposalId);
    setFeedback(null);

    try {
      const response = await fetch(`/api/finance/sales-proposals/${proposalId}/confirm-transfer`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transferReference }),
      });
      const payload = (await response.json()) as SalesProposalRecord & { message?: string };
      if (!response.ok) {
        throw new Error(payload.message || "No pudimos confirmar la transferencia.");
      }

      setProposals((current) => current.filter((proposal) => proposal.id !== proposalId));
      setConfirmedCount((current) => current + 1);
      setFeedback({
        tone: "success",
        message: payload.assignedCsmUserId
          ? "Pago confirmado. La venta volvio al flujo y ya puede activarse con su CS asignado."
          : "Pago confirmado. La venta ya puede volver al flujo comercial para asignar CS.",
      });
    } catch (caughtError) {
      setFeedback({
        tone: "error",
        message: formatUserError(caughtError, "No pudimos confirmar la transferencia."),
      });
    } finally {
      setSavingProposalId(null);
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
                <h1 className="text-2xl font-black text-slate-900">Transferencias pendientes de validar</h1>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">
                {sortedProposals.length} pendientes
              </span>
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">
                {confirmedCount} confirmadas
              </span>
            </div>
          </div>

          <p className="mt-4 max-w-3xl text-sm text-slate-600">
            Aqui validas las propuestas que se cobraran por transferencia. Al confirmar el pago,
            la venta vuelve al flujo comercial para que puedan completar la asignacion de CS.
          </p>
        </section>

        <section className="mt-6">
          {sortedProposals.length ? (
            <div className="overflow-hidden rounded-[18px] border border-slate-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.05)]">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                        Empresa
                      </th>
                      <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                        Vendedor
                      </th>
                      <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                        Inversion
                      </th>
                      <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                        Inicio
                      </th>
                      <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                        Referencia
                      </th>
                      <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                        Acciones
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {sortedProposals.map((proposal) => {
                      const proposalId = proposal.id ?? proposal.slug ?? "";

                      return (
                        <tr key={proposalId} className="align-top">
                          <td className="px-4 py-4">
                            <div className="min-w-[220px]">
                              <p className="font-bold text-slate-900">
                                {proposal.clientCompany || proposal.clientName || "Cliente sin nombre"}
                              </p>
                              <p className="mt-1 text-sm text-slate-600">{proposal.title}</p>
                              <p className="mt-2 text-sm text-slate-500">
                                {proposal.clientName || "--"} · {proposal.clientEmail || "Sin email"}
                              </p>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-sm font-semibold text-slate-800">
                            {proposal.sellerName || proposal.sellerEmail || "--"}
                          </td>
                          <td className="px-4 py-4 text-sm font-semibold text-slate-800">
                            {formatCurrency(proposal.quotedPrice, proposal.currency.toUpperCase())}
                          </td>
                          <td className="px-4 py-4 text-sm font-semibold text-slate-800">
                            {formatDate(proposal.startDate)}
                          </td>
                          <td className="px-4 py-4">
                            <div className="min-w-[220px]">
                              <Input
                                value={draftReferences[proposalId] ?? ""}
                                onChange={(event) =>
                                  setDraftReferences((current) => ({
                                    ...current,
                                    [proposalId]: event.target.value,
                                  }))
                                }
                                placeholder="Referencia bancaria"
                              />
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                onClick={() => confirmTransferPayment(proposalId)}
                                disabled={savingProposalId === proposalId}
                              >
                                {savingProposalId === proposalId ? (
                                  <Save className="mr-2 h-4 w-4" />
                                ) : (
                                  <CheckCircle2 className="mr-2 h-4 w-4" />
                                )}
                                {savingProposalId === proposalId ? "Confirmando..." : "Confirmar pago"}
                              </Button>
                              {proposal.slug ? (
                                <Link
                                  href={
                                    proposal.workspaceVariant === "dinterweb"
                                      ? `/sales/dinterweb/proposals/${proposal.slug}`
                                      : `/sales/proposals/${proposal.slug}`
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
              <p className="text-lg font-bold text-slate-900">No hay transferencias pendientes.</p>
              <p className="mt-2 text-sm text-slate-500">
                Cuando una venta se envie a revision financiera por transferencia, aparecera aqui.
              </p>
            </div>
          )}
        </section>
      </div>

      <FeedbackToast feedback={feedback} onClose={() => setFeedback(null)} />
    </>
  );
}
