import Link from "next/link";
import { ArrowRight, CalendarDays, Plus } from "lucide-react";

import { Card } from "@/components/ui/card";
import { type SalesProposalRecord } from "@/lib/sales-proposals";
import { formatCurrency } from "@/lib/utils";

type DinterwebSellerDashboardProps = {
  sellerName: string;
  proposals: SalesProposalRecord[];
};

const STATUS_COPY: Record<SalesProposalRecord["status"], string> = {
  draft: "Borrador",
  checkout_pending: "Checkout pendiente",
  paid: "Pagada",
  board_activated: "Board activado",
  archived: "Archivada",
};

function formatLongDate(value: string) {
  return new Intl.DateTimeFormat("es-NI", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("es-NI", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function DinterwebSellerDashboard({
  sellerName,
  proposals,
}: DinterwebSellerDashboardProps) {
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
                {sellerName}, aqui estan tus prospectos y propuestas
              </h1>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Desde aqui puedes retomar boards comerciales existentes o abrir una propuesta nueva
                para otro prospecto, sin mezclar nada del flujo de HubSpot.
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

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {proposals.map((proposal) => (
            <Link key={proposal.id ?? proposal.slug} href={`/sales/dinterweb/proposals/${proposal.slug}`}>
              <Card className="h-full border border-[#e2ecea] px-5 py-5 transition hover:-translate-y-0.5 hover:border-[#99ddd1] hover:shadow-[0_18px_45px_rgba(15,23,42,0.08)]">
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
                    Inicio {formatLongDate(proposal.startDate)}
                  </p>
                </div>

                <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4 text-sm text-slate-500">
                  <span>Actualizada {formatTimestamp(proposal.updatedAt)}</span>
                  <span className="inline-flex items-center font-semibold text-[#0f766e]">
                    Abrir
                    <ArrowRight className="ml-1 h-4 w-4" />
                  </span>
                </div>
              </Card>
            </Link>
          ))}
        </div>

        {!proposals.length ? (
          <Card className="border-dashed border-[#cfe5df] px-6 py-10 text-center">
            <p className="text-lg font-semibold text-slate-900">Todavia no tienes prospectos cargados</p>
            <p className="mt-2 text-sm text-slate-600">
              Crea tu primera propuesta de Dinterweb y desde ahi arma el board comercial del
              prospecto.
            </p>
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
      </div>
    </div>
  );
}
