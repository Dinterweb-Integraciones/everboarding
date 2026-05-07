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
  type SalesProposalRecord,
  type SalesProposalStatus,
} from "@/lib/sales-proposals";
import { cn, formatCurrency, formatDate, formatUserError } from "@/lib/utils";

type SalesProposalAssignmentsManagerProps = {
  initialProposals: SalesProposalRecord[];
  assignableUsers: AssignableUser[];
};

const salesStatusMeta: Record<SalesProposalStatus, { label: string; tone: string }> = {
  draft: {
    label: "Borrador",
    tone: "bg-slate-100 text-slate-700",
  },
  checkout_pending: {
    label: "Checkout pendiente",
    tone: "bg-amber-100 text-amber-800",
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

export function SalesProposalAssignmentsManager({
  initialProposals,
  assignableUsers,
}: SalesProposalAssignmentsManagerProps) {
  const [proposals, setProposals] = useState(initialProposals);
  const [draftAssignments, setDraftAssignments] = useState<Record<string, string>>(
    Object.fromEntries(
      initialProposals.map((proposal) => [proposal.id ?? proposal.slug ?? "", proposal.assignedCsmUserId || ""]),
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
      const response = await fetch(`/api/cs/sales-proposals/${proposalId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignedCsmUserId: draftAssignments[proposalId] ?? "",
        }),
      });

      const payload = (await response.json()) as SalesProposalRecord & { message?: string };
      if (!response.ok) {
        throw new Error(payload.message || "No pudimos actualizar la asignacion.");
      }

      setProposals((current) =>
        current.map((proposal) => (proposal.id === proposalId ? payload : proposal)),
      );
      setDraftAssignments((current) => ({
        ...current,
        [proposalId]: payload.assignedCsmUserId || "",
      }));
      setFeedback({ tone: "success", message: "Asignacion actualizada." });
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
                          Inversion
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                          Cliente
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                          CS actual
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
                        const selectedAssignment = draftAssignments[proposalId] ?? proposal.assignedCsmUserId ?? "";
                        const hasChanges = selectedAssignment !== (proposal.assignedCsmUserId || "");
                        const assigneeName = getAssigneeName(assignableUsers, proposal.assignedCsmUserId);

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
                            <td className="px-4 py-4 text-sm font-semibold text-slate-800">
                              {proposal.sellerName || proposal.sellerEmail || "--"}
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
                              <div className="min-w-[180px]">
                                <Select
                                  value={selectedAssignment}
                                  onChange={(event) =>
                                    setDraftAssignments((current) => ({
                                      ...current,
                                      [proposalId]: event.target.value,
                                    }))
                                  }
                                  disabled={!assignableUsers.length || !proposalId}
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
                                  {savingProposalId === proposalId ? "Guardando..." : "Guardar"}
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
                  const selectedAssignment = draftAssignments[proposalId] ?? proposal.assignedCsmUserId ?? "";
                  const hasChanges = selectedAssignment !== (proposal.assignedCsmUserId || "");
                  const assigneeName = getAssigneeName(assignableUsers, proposal.assignedCsmUserId);

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
                          <p className="mt-1 text-sm font-semibold text-slate-800">
                            {proposal.sellerName || proposal.sellerEmail || "--"}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">CS actual</p>
                          <p className="mt-1 text-sm font-semibold text-slate-800">
                            {assigneeName || "Sin asignar"}
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
                          value={selectedAssignment}
                          onChange={(event) =>
                            setDraftAssignments((current) => ({
                              ...current,
                              [proposalId]: event.target.value,
                            }))
                          }
                          disabled={!assignableUsers.length || !proposalId}
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
                            {savingProposalId === proposalId ? "Guardando..." : "Guardar"}
                          </Button>
                          {proposal.slug ? (
                            <Link
                              href={`/sales/proposals/${proposal.slug}`}
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
