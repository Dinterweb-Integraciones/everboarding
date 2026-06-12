"use client";

import Link from "next/link";
import { BriefcaseBusiness, ExternalLink, Save } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { FeedbackToast } from "@/components/ui/feedback-toast";
import { Select } from "@/components/ui/select";
import type { AssignableUser } from "@/lib/onboarding";
import {
  getAssigneeName,
  normalizeSalesCreditValidityDays,
  normalizeSalesPaymentMethod,
  type SalesProposalPaymentMethod,
  type SalesProposalRecord,
  type SalesProposalStatus,
} from "@/lib/sales-proposals";
import { cn, formatCurrency, formatDate, formatUserError } from "@/lib/utils";

type SalesProposalAssignmentsManagerProps = {
  initialProposals: SalesProposalRecord[];
  assignableUsers: AssignableUser[];
  sellerUsers: AssignableUser[];
};

const CREDIT_VALIDITY_OPTIONS = [60, 90, 120] as const;

function resolveSellerSelection(proposal: SalesProposalRecord, sellerUsers: AssignableUser[]) {
  const normalizedSellerEmail = proposal.sellerEmail.trim().toLowerCase();
  if (!normalizedSellerEmail) {
    return "";
  }

  return sellerUsers.find((user) => user.email.trim().toLowerCase() === normalizedSellerEmail)?.id ?? "";
}

function resolveSellerDisplayLabel(proposal: SalesProposalRecord) {
  return proposal.sellerName || proposal.sellerEmail || "Sin asignar";
}

const salesStatusMeta: Record<SalesProposalStatus, { label: string; tone: string }> = {
  draft: {
    label: "Borrador",
    tone: "bg-slate-100 text-slate-700",
  },
  checkout_pending: {
    label: "Checkout pendiente",
    tone: "bg-amber-100 text-amber-800",
  },
  transfer_pending: {
    label: "Pendiente finanzas",
    tone: "bg-sky-100 text-sky-800",
  },
  paid: {
    label: "Pagada",
    tone: "bg-emerald-100 text-emerald-800",
  },
  board_activated: {
    label: "Activada",
    tone: "bg-cyan-100 text-cyan-800",
  },
  archived: {
    label: "Archivada",
    tone: "bg-rose-100 text-rose-700",
  },
};

function shouldRouteProposalToFinance(
  proposalStatus: SalesProposalStatus,
  paymentMethod: SalesProposalPaymentMethod,
) {
  return paymentMethod === "bank_transfer" && proposalStatus === "draft";
}

function getCreditValidityOptions(value: number) {
  return Array.from(new Set([...CREDIT_VALIDITY_OPTIONS, value]))
    .filter((days) => days > 0)
    .sort((left, right) => left - right);
}

export function SalesProposalAssignmentsManager({
  initialProposals,
  assignableUsers,
  sellerUsers,
}: SalesProposalAssignmentsManagerProps) {
  const [proposals, setProposals] = useState(initialProposals);
  const [draftPaymentMethods, setDraftPaymentMethods] = useState<Record<string, SalesProposalPaymentMethod>>(
    Object.fromEntries(
      initialProposals.map((proposal) => [proposal.id ?? proposal.slug ?? "", proposal.paymentMethod]),
    ),
  );
  const [draftAssignments, setDraftAssignments] = useState<Record<string, string>>(
    Object.fromEntries(
      initialProposals.map((proposal) => [proposal.id ?? proposal.slug ?? "", proposal.assignedCsmUserId || ""]),
    ),
  );
  const [draftSellerAssignments, setDraftSellerAssignments] = useState<Record<string, string>>(
    Object.fromEntries(
      initialProposals.map((proposal) => [
        proposal.id ?? proposal.slug ?? "",
        resolveSellerSelection(proposal, sellerUsers),
      ]),
    ),
  );
  const [draftCreditValidityDays, setDraftCreditValidityDays] = useState<Record<string, number>>(
    Object.fromEntries(
      initialProposals.map((proposal) => [
        proposal.id ?? proposal.slug ?? "",
        proposal.creditValidityDays,
      ]),
    ),
  );
  const [savingProposalId, setSavingProposalId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);

  const summary = useMemo(() => {
    const assigned = proposals.filter((proposal) => proposal.assignedCsmUserId).length;

    return {
      total: proposals.length,
      assigned,
      pending: proposals.length - assigned,
    };
  }, [proposals]);

  const sortedProposals = useMemo(() => {
    return [...proposals].sort((left, right) => {
      const leftPriority = left.assignedCsmUserId ? 1 : 0;
      const rightPriority = right.assignedCsmUserId ? 1 : 0;

      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }

      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });
  }, [proposals]);

  async function saveAssignment(proposalId: string) {
    setSavingProposalId(proposalId);
    setFeedback(null);

    try {
      const selectedProposal = proposals.find((proposal) => (proposal.id ?? proposal.slug ?? "") === proposalId);

      if (!selectedProposal) {
        throw new Error("No encontramos la venta seleccionada.");
      }

      const selectedPaymentMethod = normalizeSalesPaymentMethod(draftPaymentMethods[proposalId]);
      const shouldRouteToFinance = shouldRouteProposalToFinance(
        selectedProposal.status,
        selectedPaymentMethod,
      );
      const response = await fetch(`/api/cs/sales-proposals/${proposalId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sellerProfileId: draftSellerAssignments[proposalId] ?? "",
          assignedCsmUserId: shouldRouteToFinance ? "" : draftAssignments[proposalId] ?? "",
          paymentMethod: selectedPaymentMethod,
          creditValidityDays: draftCreditValidityDays[proposalId] ?? selectedProposal.creditValidityDays,
        }),
      });

      const payload = (await response.json()) as SalesProposalRecord & { message?: string };
      if (!response.ok) {
        throw new Error(payload.message || "No pudimos actualizar la asignacion.");
      }

      if (payload.status === "transfer_pending") {
        setProposals((current) => current.filter((proposal) => proposal.id !== proposalId));
      } else {
        setProposals((current) =>
          current.map((proposal) => (proposal.id === proposalId ? payload : proposal)),
        );
      }
      setDraftPaymentMethods((current) => ({
        ...current,
        [proposalId]: payload.paymentMethod,
      }));
      setDraftAssignments((current) => ({
        ...current,
        [proposalId]: payload.assignedCsmUserId || "",
      }));
      setDraftSellerAssignments((current) => ({
        ...current,
        [proposalId]: resolveSellerSelection(payload, sellerUsers),
      }));
      setDraftCreditValidityDays((current) => ({
        ...current,
        [proposalId]: payload.creditValidityDays,
      }));
      setFeedback({
        tone: "success",
        message:
          payload.status === "transfer_pending"
            ? "Venta enviada a Finanzas para validar la transferencia."
            : "Catalogo actualizado.",
      });
    } catch (caughtError) {
      setFeedback({
        tone: "error",
        message: formatUserError(caughtError, "No pudimos actualizar la asignacion."),
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
                <BriefcaseBusiness className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                  Catalogo CS
                </p>
                <h1 className="text-2xl font-black text-slate-900">Ventas para asignacion de CS</h1>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                {summary.total} ventas
              </span>
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">
                {summary.assigned} asignadas
              </span>
              <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">
                {summary.pending} pendientes
              </span>
            </div>
          </div>

          <p className="mt-4 max-w-3xl text-sm text-slate-600">
            Aqui recibes todas las propuestas comerciales generadas por ventas y decides que CS se
            hara cargo. La lista prioriza las ventas sin asignar y luego las mas recientes.
          </p>

          {!assignableUsers.length ? (
            <div className="mt-5 rounded-[12px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              No encontramos usuarios disponibles para asignar como CS.
            </div>
          ) : null}
        </section>

        <section className="mt-6">
          {sortedProposals.length ? (
            <>
              <div className="mb-3 px-1 text-sm font-semibold text-slate-700">
                Orden actual: pendientes de CS primero, luego actualizadas mas recientemente.
              </div>

              <div className="hidden overflow-hidden rounded-[18px] border border-slate-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.05)] lg:block">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                          Empresa
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                          Estado
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                          Vendedor
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                          Inicio
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                          Actualizada
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                          Creditos
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                          Vigencia
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                          Inversion
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                          Cliente
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                          CS actual
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                          Pago
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                          Asignar CS
                        </th>
                        <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                          Acciones
                        </th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-200">
                      {sortedProposals.map((proposal) => {
                        const proposalId = proposal.id ?? proposal.slug ?? "";
                        const selectedPaymentMethod =
                          draftPaymentMethods[proposalId] ?? proposal.paymentMethod ?? "stripe";
                        const selectedAssignment = draftAssignments[proposalId] ?? proposal.assignedCsmUserId ?? "";
                        const selectedSeller = draftSellerAssignments[proposalId] ?? resolveSellerSelection(proposal, sellerUsers);
                        const selectedCreditValidityDays =
                          draftCreditValidityDays[proposalId] ?? proposal.creditValidityDays;
                        const initialSellerSelection = resolveSellerSelection(proposal, sellerUsers);
                        const hasChanges =
                          selectedAssignment !== (proposal.assignedCsmUserId || "")
                          || selectedPaymentMethod !== proposal.paymentMethod
                          || selectedSeller !== initialSellerSelection
                          || selectedCreditValidityDays !== proposal.creditValidityDays;
                        const assigneeName = getAssigneeName(assignableUsers, proposal.assignedCsmUserId);
                        const shouldRouteToFinance = shouldRouteProposalToFinance(
                          proposal.status,
                          selectedPaymentMethod,
                        );

                        return (
                          <tr
                            key={proposalId}
                            className={cn(
                              "align-top transition",
                              !proposal.assignedCsmUserId && "bg-amber-50/60",
                              hasChanges && "bg-[color-mix(in_oklab,var(--accent)_8%,white)]",
                            )}
                          >
                            <td className="px-4 py-4">
                              <div className="min-w-[160px]">
                                <p className="font-bold text-slate-900">
                                  {proposal.clientCompany || proposal.clientName || "Cliente sin nombre"}
                                </p>
                                <p className="mt-1 text-sm text-slate-600">{proposal.title}</p>
                              </div>
                            </td>
                            <td className="px-4 py-4">
                              <div className="flex min-w-[150px] flex-wrap gap-2">
                                <span
                                  className={cn(
                                    "inline-flex rounded-full px-3 py-1 text-[11px] font-bold",
                                    salesStatusMeta[proposal.status].tone,
                                  )}
                                >
                                  {salesStatusMeta[proposal.status].label}
                                </span>
                                {!proposal.assignedCsmUserId ? (
                                  <span className="inline-flex rounded-full bg-amber-100 px-3 py-1 text-[11px] font-bold text-amber-800">
                                    Pendiente CS
                                  </span>
                                ) : null}
                                {proposal.activatedClientId ? (
                                  <span className="inline-flex rounded-full bg-cyan-50 px-3 py-1 text-[11px] font-bold text-cyan-700">
                                    Cliente activo
                                  </span>
                                ) : null}
                              </div>
                            </td>
                            <td className="px-4 py-4">
                              <div className="min-w-[190px]">
                                <Select
                                  value={selectedSeller}
                                  onChange={(event) =>
                                    setDraftSellerAssignments((current) => ({
                                      ...current,
                                      [proposalId]: event.target.value,
                                    }))
                                  }
                                  disabled={!sellerUsers.length || !proposalId}
                                >
                                  {!selectedSeller && (proposal.sellerName || proposal.sellerEmail) ? (
                                    <option value="">{resolveSellerDisplayLabel(proposal)}</option>
                                  ) : (
                                    <option value="">Sin asignar</option>
                                  )}
                                  {sellerUsers.map((user) => (
                                    <option key={user.id} value={user.id}>
                                      {user.full_name || user.email}
                                    </option>
                                  ))}
                                </Select>
                              </div>
                            </td>
                            <td className="px-4 py-4 text-sm font-semibold text-slate-800">
                              {formatDate(proposal.startDate)}
                            </td>
                            <td className="px-4 py-4 text-sm font-semibold text-slate-800">
                              {formatDate(proposal.updatedAt)}
                            </td>
                            <td className="px-4 py-4 text-sm font-semibold text-slate-800">
                              {proposal.contractedCredits} CR
                            </td>
                            <td className="px-4 py-4">
                              <div className="min-w-[130px]">
                                {proposal.billingMode === "one_time" ? (
                                  <Select
                                    value={String(selectedCreditValidityDays)}
                                    onChange={(event) =>
                                      setDraftCreditValidityDays((current) => ({
                                        ...current,
                                        [proposalId]: normalizeSalesCreditValidityDays(
                                          event.target.value,
                                          proposal.billingMode,
                                        ),
                                      }))
                                    }
                                    disabled={!proposalId}
                                  >
                                    {getCreditValidityOptions(selectedCreditValidityDays).map((days) => (
                                      <option key={days} value={days}>
                                        {days} dias
                                      </option>
                                    ))}
                                  </Select>
                                ) : (
                                  <span className="text-sm font-semibold text-slate-800">
                                    {proposal.creditValidityDays} dias
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-4 text-sm font-semibold text-slate-800">
                              {formatCurrency(proposal.quotedPrice, proposal.currency.toUpperCase())}
                            </td>
                            <td className="px-4 py-4">
                              <div className="min-w-[190px]">
                                <p className="text-sm font-semibold text-slate-900">
                                  {proposal.clientName || "--"}
                                </p>
                                <p className="mt-1 text-sm text-slate-600">
                                  {proposal.clientEmail || "Sin email registrado"}
                                </p>
                                <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-500">
                                  {proposal.clientDescription || "Sin contexto adicional registrado."}
                                </p>
                              </div>
                            </td>
                            <td className="px-4 py-4 text-sm font-semibold text-slate-800">
                              {assigneeName || "Sin asignar"}
                            </td>
                            <td className="px-4 py-4">
                              <div className="min-w-[170px]">
                                <Select
                                  value={selectedPaymentMethod}
                                  onChange={(event) => {
                                    const nextPaymentMethod = normalizeSalesPaymentMethod(event.target.value);
                                    setDraftPaymentMethods((current) => ({
                                      ...current,
                                      [proposalId]: nextPaymentMethod,
                                    }));
                                    if (nextPaymentMethod === "bank_transfer") {
                                      setDraftAssignments((current) => ({
                                        ...current,
                                        [proposalId]: "",
                                      }));
                                    }
                                  }}
                                  disabled={!proposalId || proposal.status === "paid" || proposal.status === "board_activated"}
                                >
                                  <option value="stripe">Stripe</option>
                                  <option value="bank_transfer">Transferencia</option>
                                </Select>
                              </div>
                            </td>
                            <td className="px-4 py-4">
                              <div className="min-w-[180px]">
                                <Select
                                  value={selectedAssignment}
                                  onChange={(event) =>
                                    setDraftAssignments((current) => ({
                                      ...current,
                                      [proposalId]: event.target.value,
                                    }))
                                  }
                                  disabled={!assignableUsers.length || !proposalId || shouldRouteToFinance}
                                >
                                  <option value="">Sin asignar</option>
                                  {assignableUsers.map((user) => (
                                    <option key={user.id} value={user.id}>
                                      {user.full_name || user.email}
                                    </option>
                                  ))}
                                </Select>
                              </div>
                            </td>
                            <td className="px-4 py-4">
                              <div className="flex min-w-[170px] items-center justify-end gap-2">
                                <Button
                                  className="px-3 py-2 text-sm"
                                  onClick={() => saveAssignment(proposalId)}
                                  disabled={!proposalId || !hasChanges || savingProposalId === proposalId}
                                >
                                  <Save className="mr-2 h-4 w-4" />
                                  {savingProposalId === proposalId
                                    ? "Guardando..."
                                    : shouldRouteToFinance
                                      ? "Enviar a Finanzas"
                                      : "Guardar"}
                                </Button>
                                {proposal.slug ? (
                                  <Link
                                    href={`/sales/proposals/${proposal.slug}`}
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

              <div className="space-y-4 lg:hidden">
                {sortedProposals.map((proposal) => {
                  const proposalId = proposal.id ?? proposal.slug ?? "";
                  const selectedPaymentMethod =
                    draftPaymentMethods[proposalId] ?? proposal.paymentMethod ?? "stripe";
                  const selectedAssignment = draftAssignments[proposalId] ?? proposal.assignedCsmUserId ?? "";
                  const selectedSeller = draftSellerAssignments[proposalId] ?? resolveSellerSelection(proposal, sellerUsers);
                  const selectedCreditValidityDays =
                    draftCreditValidityDays[proposalId] ?? proposal.creditValidityDays;
                  const initialSellerSelection = resolveSellerSelection(proposal, sellerUsers);
                  const hasChanges =
                    selectedAssignment !== (proposal.assignedCsmUserId || "")
                    || selectedPaymentMethod !== proposal.paymentMethod
                    || selectedSeller !== initialSellerSelection
                    || selectedCreditValidityDays !== proposal.creditValidityDays;
                  const assigneeName = getAssigneeName(assignableUsers, proposal.assignedCsmUserId);
                  const shouldRouteToFinance = shouldRouteProposalToFinance(
                    proposal.status,
                    selectedPaymentMethod,
                  );

                  return (
                    <article
                      key={proposalId}
                      className={cn(
                        "rounded-[18px] border bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.05)] transition",
                        !proposal.assignedCsmUserId ? "border-amber-200 bg-amber-50/40" : "border-slate-200",
                        hasChanges && "border-[var(--accent)]",
                      )}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-lg font-black text-slate-900">
                            {proposal.clientCompany || proposal.clientName || "Cliente sin nombre"}
                          </p>
                          <p className="mt-1 text-sm text-slate-600">{proposal.title}</p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <span
                            className={cn(
                              "inline-flex rounded-full px-3 py-1 text-[11px] font-bold",
                              salesStatusMeta[proposal.status].tone,
                            )}
                          >
                            {salesStatusMeta[proposal.status].label}
                          </span>
                          {!proposal.assignedCsmUserId ? (
                            <span className="inline-flex rounded-full bg-amber-100 px-3 py-1 text-[11px] font-bold text-amber-800">
                              Pendiente CS
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <div>
                          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">Vendedor</p>
                          <div className="mt-1">
                            <Select
                              value={selectedSeller}
                              onChange={(event) =>
                                setDraftSellerAssignments((current) => ({
                                  ...current,
                                  [proposalId]: event.target.value,
                                }))
                              }
                              disabled={!sellerUsers.length || !proposalId}
                            >
                              {!selectedSeller && (proposal.sellerName || proposal.sellerEmail) ? (
                                <option value="">{resolveSellerDisplayLabel(proposal)}</option>
                              ) : (
                                <option value="">Sin asignar</option>
                              )}
                              {sellerUsers.map((user) => (
                                <option key={user.id} value={user.id}>
                                  {user.full_name || user.email}
                                </option>
                              ))}
                            </Select>
                          </div>
                        </div>
                        <div>
                          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">CS actual</p>
                          <p className="mt-1 text-sm font-semibold text-slate-800">
                            {assigneeName || "Sin asignar"}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">Pago</p>
                          <p className="mt-1 text-sm font-semibold text-slate-800">
                            {selectedPaymentMethod === "bank_transfer" ? "Transferencia" : "Stripe"}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">Inicio</p>
                          <p className="mt-1 text-sm font-semibold text-slate-800">{formatDate(proposal.startDate)}</p>
                        </div>
                        <div>
                          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">Actualizada</p>
                          <p className="mt-1 text-sm font-semibold text-slate-800">{formatDate(proposal.updatedAt)}</p>
                        </div>
                        <div>
                          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">Creditos</p>
                          <p className="mt-1 text-sm font-semibold text-slate-800">{proposal.contractedCredits} CR</p>
                        </div>
                        <div>
                          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">Vigencia</p>
                          {proposal.billingMode === "one_time" ? (
                            <div className="mt-1">
                              <Select
                                value={String(selectedCreditValidityDays)}
                                onChange={(event) =>
                                  setDraftCreditValidityDays((current) => ({
                                    ...current,
                                    [proposalId]: normalizeSalesCreditValidityDays(
                                      event.target.value,
                                      proposal.billingMode,
                                    ),
                                  }))
                                }
                                disabled={!proposalId}
                              >
                                {getCreditValidityOptions(selectedCreditValidityDays).map((days) => (
                                  <option key={days} value={days}>
                                    {days} dias
                                  </option>
                                ))}
                              </Select>
                            </div>
                          ) : (
                            <p className="mt-1 text-sm font-semibold text-slate-800">
                              {proposal.creditValidityDays} dias
                            </p>
                          )}
                        </div>
                        <div>
                          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">Inversion</p>
                          <p className="mt-1 text-sm font-semibold text-slate-800">
                            {formatCurrency(proposal.quotedPrice, proposal.currency.toUpperCase())}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 rounded-[14px] border border-slate-200 bg-slate-50 p-4">
                        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">Cliente</p>
                        <p className="mt-1 text-sm font-semibold text-slate-900">{proposal.clientName || "--"}</p>
                        <p className="mt-1 text-sm text-slate-600">{proposal.clientEmail || "Sin email registrado"}</p>
                        <p className="mt-2 text-sm leading-6 text-slate-500">
                          {proposal.clientDescription || "Sin contexto adicional registrado."}
                        </p>
                      </div>

                      <div className="mt-4 space-y-3">
                        <Select
                          value={selectedPaymentMethod}
                          onChange={(event) => {
                            const nextPaymentMethod = normalizeSalesPaymentMethod(event.target.value);
                            setDraftPaymentMethods((current) => ({
                              ...current,
                              [proposalId]: nextPaymentMethod,
                            }));
                            if (nextPaymentMethod === "bank_transfer") {
                              setDraftAssignments((current) => ({
                                ...current,
                                [proposalId]: "",
                              }));
                            }
                          }}
                          disabled={!proposalId || proposal.status === "paid" || proposal.status === "board_activated"}
                        >
                          <option value="stripe">Stripe</option>
                          <option value="bank_transfer">Transferencia</option>
                        </Select>

                        <Select
                          value={selectedAssignment}
                          onChange={(event) =>
                            setDraftAssignments((current) => ({
                              ...current,
                              [proposalId]: event.target.value,
                            }))
                          }
                          disabled={!assignableUsers.length || !proposalId || shouldRouteToFinance}
                        >
                          <option value="">Sin asignar</option>
                          {assignableUsers.map((user) => (
                            <option key={user.id} value={user.id}>
                              {user.full_name || user.email}
                            </option>
                          ))}
                        </Select>

                        <div className="flex gap-2">
                          <Button
                            className="flex-1"
                            onClick={() => saveAssignment(proposalId)}
                            disabled={!proposalId || !hasChanges || savingProposalId === proposalId}
                          >
                            <Save className="mr-2 h-4 w-4" />
                            {savingProposalId === proposalId
                              ? "Guardando..."
                              : shouldRouteToFinance
                                ? "Enviar a Finanzas"
                                : "Guardar"}
                          </Button>
                          {proposal.slug ? (
                            <Link
                              href={
                                proposal.workspaceVariant === "dinterweb"
                                  ? `/sales/dinterweb/proposals/${proposal.slug}`
                                  : `/sales/proposals/${proposal.slug}`
                              }
                              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                            >
                              Ver
                              <ExternalLink className="h-4 w-4" />
                            </Link>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          ) : (
            <section className="rounded-[18px] border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500 shadow-[0_18px_50px_rgba(15,23,42,0.04)]">
              Aun no hay ventas registradas por el equipo comercial.
            </section>
          )}
        </section>
      </div>

      <FeedbackToast feedback={feedback} onClose={() => setFeedback(null)} />
    </>
  );
}
