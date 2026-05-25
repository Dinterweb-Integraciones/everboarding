"use client";

import Link from "next/link";
import { ArrowRight, CalendarDays, Copy, Plus } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { type SalesProposalRecord } from "@/lib/sales-proposals";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils";

type DinterwebSellerDashboardProps = {
  sellerName: string;
  proposals: SalesProposalRecord[];
  isGlobalView?: boolean;
};

const STATUS_COPY: Record<SalesProposalRecord["status"], string> = {
  draft: "Borrador",
  checkout_pending: "Checkout pendiente",
  transfer_pending: "Pendiente finanzas",
  paid: "Pagada",
  board_activated: "Board activado",
  archived: "Archivada",
};

const PAGE_SIZE_OPTIONS = [9, 18, 36];

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function DinterwebSellerDashboard({
  sellerName,
  proposals,
  isGlobalView = false,
}: DinterwebSellerDashboardProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [pageSize, setPageSize] = useState(9);
  const [currentPage, setCurrentPage] = useState(1);
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const filteredProposals = useMemo(() => {
    const normalizedQuery = normalizeSearchText(deferredSearchQuery);
    if (!normalizedQuery) {
      return proposals;
    }

    return proposals.filter((proposal) => {
      const searchableText = [
        proposal.clientCompany || "",
        proposal.clientName || "",
        STATUS_COPY[proposal.status],
        proposal.billingMode === "subscription" ? "recurrencia" : "paquete de creditos",
      ].join(" ");

      return normalizeSearchText(searchableText).includes(normalizedQuery);
    });
  }, [deferredSearchQuery, proposals]);

  const totalPages = Math.max(1, Math.ceil(filteredProposals.length / pageSize));
  const activePage = Math.min(currentPage, totalPages);

  const paginatedProposals = useMemo(() => {
    const startIndex = (activePage - 1) * pageSize;
    return filteredProposals.slice(startIndex, startIndex + pageSize);
  }, [activePage, filteredProposals, pageSize]);

  const visiblePageNumbers = useMemo(() => {
    const maxVisiblePages = 5;
    const halfWindow = Math.floor(maxVisiblePages / 2);
    let startPage = Math.max(1, activePage - halfWindow);
    const endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

    startPage = Math.max(1, endPage - maxVisiblePages + 1);

    return Array.from({ length: endPage - startPage + 1 }, (_, index) => startPage + index);
  }, [activePage, totalPages]);

  const pageRangeStart = filteredProposals.length === 0 ? 0 : (activePage - 1) * pageSize + 1;
  const pageRangeEnd = Math.min(activePage * pageSize, filteredProposals.length);

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f3fbf9_0%,#fcfcfc_38%)] px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <Card className="overflow-hidden border-[#d9efe9]">
          <div className="flex flex-col gap-6 px-6 py-7 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#0f766e]">
                Ventas Dinterweb
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-slate-950">
                {isGlobalView
                  ? "Aqui tienes la vista global de propuestas Dinterweb"
                  : `${sellerName}, aqui estan tus prospectos y propuestas`}
              </h1>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                {isGlobalView
                  ? "Desde aqui puedes revisar todas las propuestas comerciales del flujo Dinterweb y abrir cualquiera para seguimiento o supervision."
                  : "Desde aqui puedes retomar boards comerciales existentes o abrir una propuesta nueva para otro prospecto, sin mezclar nada del flujo de HubSpot."}
              </p>
            </div>

            <Link
              href="/sales/dinterweb/proposals/new"
              className="inline-flex items-center justify-center rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)]"
            >
              <Plus className="mr-2 h-4 w-4" />
              Nueva propuesta
            </Link>
          </div>
        </Card>

        <Card className="border-[#d9efe9] p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="w-full max-w-xl">
              <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                Buscar prospecto
              </label>
              <Input
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Buscar por empresa, prospecto o estado"
              />
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="min-w-[140px]">
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Por pagina
                </label>
                <Select
                  value={String(pageSize)}
                  onChange={(event) => {
                    setPageSize(Number(event.target.value) || 9);
                    setCurrentPage(1);
                  }}
                >
                  {PAGE_SIZE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              </div>

              <p className="text-sm text-slate-600">
                Mostrando {pageRangeStart}-{pageRangeEnd} de {filteredProposals.length} propuestas
              </p>
            </div>
          </div>
        </Card>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {paginatedProposals.map((proposal) => (
            <Card
              key={proposal.id ?? proposal.slug}
              className="h-full border border-[#e2ecea] px-5 py-5 transition hover:-translate-y-0.5 hover:border-[#99ddd1] hover:shadow-[0_18px_45px_rgba(15,23,42,0.08)]"
            >
              <div className="flex h-full flex-col">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-lg font-semibold text-slate-950">
                      {proposal.clientCompany || proposal.clientName}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      {proposal.clientName || "Prospecto sin nombre"}
                    </p>
                  </div>
                  <span className="rounded-full bg-[#ecfdf5] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#0f766e]">
                    {STATUS_COPY[proposal.status]}
                  </span>
                </div>

                <div className="mt-5 space-y-2 text-sm text-slate-600">
                  <p>
                    <span className="font-semibold text-slate-900">{proposal.contractedCredits} CR</span>
                    {" · "}
                    {formatCurrency(proposal.quotedPrice, proposal.currency.toUpperCase())}
                  </p>
                  <p>
                    {proposal.billingMode === "subscription"
                      ? `Recurrencia cada ${proposal.periodMonths === 1 ? "mes" : `${proposal.periodMonths} meses`}`
                      : "Paquete de creditos"}
                  </p>
                  <p className="flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-slate-400" />
                    Inicio {formatDate(proposal.startDate)}
                  </p>
                </div>

                <div className="mt-auto flex items-center justify-between border-t border-slate-100 pt-4 text-sm text-slate-500">
                  <span>Actualizada {formatDateTime(proposal.updatedAt)}</span>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      if (!proposal.slug) return;
                      window.open(
                        `/sales/dinterweb/proposals/new?duplicateFrom=${encodeURIComponent(proposal.slug)}`,
                        "_blank",
                      );
                    }}
                    className="inline-flex items-center gap-2 rounded-xl border border-[#cfe5df] bg-white px-3 py-2 text-sm font-semibold text-[#0f766e] transition hover:border-[#99ddd1] hover:bg-[#f3fbf9]"
                  >
                    <Copy className="h-4 w-4" />
                    Duplicar propuesta
                  </button>

                  <Link
                    href={`/sales/dinterweb/proposals/${proposal.slug}`}
                    className="inline-flex items-center font-semibold text-[#0f766e]"
                  >
                    Abrir
                    <ArrowRight className="ml-1 h-4 w-4" />
                  </Link>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {!paginatedProposals.length ? (
          <Card className="border-dashed border-[#cfe5df] px-6 py-10 text-center">
            {filteredProposals.length === 0 && searchQuery ? (
              <>
                <p className="text-lg font-semibold text-slate-900">No encontramos prospectos</p>
                <p className="mt-2 text-sm text-slate-600">
                  Prueba con otro nombre de empresa, prospecto o estado para encontrar la propuesta.
                </p>
              </>
            ) : (
              <>
                <p className="text-lg font-semibold text-slate-900">
                  {isGlobalView
                    ? "Todavia no hay propuestas cargadas en Dinterweb"
                    : "Todavia no tienes prospectos cargados"}
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  {isGlobalView
                    ? "Cuando el equipo comercial cree propuestas Dinterweb, apareceran aqui para seguimiento."
                    : "Crea tu primera propuesta de Dinterweb y desde ahi arma el board comercial del prospecto."}
                </p>
              </>
            )}
            <div className="mt-5">
              <Link
                href="/sales/dinterweb/proposals/new"
                className="inline-flex items-center rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)]"
              >
                <Plus className="mr-2 h-4 w-4" />
                Crear primera propuesta
              </Link>
            </div>
          </Card>
        ) : null}

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <p className="text-sm text-slate-600">
            Pagina {activePage} de {totalPages}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setCurrentPage((current) => Math.max(1, current - 1))}
              disabled={activePage === 1}
            >
              Anterior
            </Button>

            {visiblePageNumbers.map((pageNumber) => (
              <Button
                key={pageNumber}
                type="button"
                variant={pageNumber === activePage ? "primary" : "secondary"}
                onClick={() => setCurrentPage(pageNumber)}
                className="min-w-[44px] px-3"
              >
                {pageNumber}
              </Button>
            ))}

            <Button
              type="button"
              variant="secondary"
              onClick={() => setCurrentPage((current) => Math.min(totalPages, current + 1))}
              disabled={activePage === totalPages}
            >
              Siguiente
            </Button>
          </div>
        </div>
      </div>

    </div>
  );
}
