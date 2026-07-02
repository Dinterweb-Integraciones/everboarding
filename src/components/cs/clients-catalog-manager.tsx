"use client";

import Link from "next/link";
import { CheckCircle2, CircleOff, Search, Users } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";

import { FeedbackToast } from "@/components/ui/feedback-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn, formatUserError } from "@/lib/utils";

export type ClientCatalogRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_active: boolean;
  seller_user_id: string | null;
  csm_user_id: string | null;
  created_at: string;
  updated_at: string;
  seller_name: string | null;
  csm_name: string | null;
};

type ClientsCatalogManagerProps = {
  initialClients: ClientCatalogRow[];
};

type StatusFilter = "active" | "all" | "inactive";

const PAGE_SIZE_OPTIONS = [10, 25, 50];

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function getStatusLabel(isActive: boolean) {
  return isActive ? "Activo" : "Inactivo";
}

export function ClientsCatalogManager({ initialClients }: ClientsCatalogManagerProps) {
  const [clients, setClients] = useState(initialClients);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [searchQuery, setSearchQuery] = useState("");
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [savingClientId, setSavingClientId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const summary = useMemo(() => {
    const active = clients.filter((client) => client.is_active).length;
    return {
      total: clients.length,
      active,
      inactive: clients.length - active,
    };
  }, [clients]);

  const filteredClients = useMemo(() => {
    const normalizedQuery = normalizeSearchText(deferredSearchQuery);

    return clients.filter((client) => {
      if (statusFilter === "active" && !client.is_active) return false;
      if (statusFilter === "inactive" && client.is_active) return false;

      if (!normalizedQuery) return true;

      const searchableText = [
        client.name,
        client.slug,
        client.description ?? "",
        client.seller_name ?? "",
        client.csm_name ?? "",
        getStatusLabel(client.is_active),
      ].join(" ");

      return normalizeSearchText(searchableText).includes(normalizedQuery);
    });
  }, [clients, deferredSearchQuery, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredClients.length / pageSize));
  const activePage = Math.min(currentPage, totalPages);
  const pageRangeStart = filteredClients.length === 0 ? 0 : (activePage - 1) * pageSize + 1;
  const pageRangeEnd = Math.min(activePage * pageSize, filteredClients.length);

  const paginatedClients = useMemo(() => {
    const startIndex = (activePage - 1) * pageSize;
    return filteredClients.slice(startIndex, startIndex + pageSize);
  }, [activePage, filteredClients, pageSize]);

  const visiblePageNumbers = useMemo(() => {
    const maxVisiblePages = 5;
    const halfWindow = Math.floor(maxVisiblePages / 2);
    let startPage = Math.max(1, activePage - halfWindow);
    const endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

    startPage = Math.max(1, endPage - maxVisiblePages + 1);

    return Array.from({ length: endPage - startPage + 1 }, (_, index) => startPage + index);
  }, [activePage, totalPages]);

  async function toggleClientStatus(client: ClientCatalogRow) {
    const nextStatus = !client.is_active;

    setSavingClientId(client.id);
    setFeedback(null);
    setClients((current) =>
      current.map((entry) => (entry.id === client.id ? { ...entry, is_active: nextStatus } : entry)),
    );

    try {
      const response = await fetch(`/api/cs/clients/${client.id}/active`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: nextStatus }),
      });

      const payload = (await response.json()) as Partial<ClientCatalogRow> & { message?: string };
      if (!response.ok) {
        throw new Error(payload.message || "No pudimos actualizar el estado.");
      }

      setClients((current) =>
        current.map((entry) =>
          entry.id === client.id
            ? {
                ...entry,
                is_active: Boolean(payload.is_active),
                updated_at: payload.updated_at ?? entry.updated_at,
              }
            : entry,
        ),
      );
      setFeedback({
        tone: "success",
        message: payload.message || "Estado actualizado.",
      });
    } catch (caughtError) {
      setClients((current) =>
        current.map((entry) => (entry.id === client.id ? { ...entry, is_active: client.is_active } : entry)),
      );
      setFeedback({
        tone: "error",
        message: formatUserError(caughtError, "No pudimos actualizar el estado del cliente."),
      });
    } finally {
      setSavingClientId(null);
    }
  }

  return (
    <>
      <div className="mx-auto w-full max-w-none px-3 py-8 sm:px-4 lg:px-6 xl:px-8">
        <section className="rounded-[18px] border border-slate-200 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.05)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-[#ecfffb] text-[#00a48f]">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                  Customer Success
                </p>
                <h1 className="text-2xl font-black text-slate-900">Catalogo de clientes</h1>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                {summary.total} clientes
              </span>
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">
                {summary.active} activos
              </span>
              <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-bold text-rose-700">
                {summary.inactive} inactivos
              </span>
            </div>
          </div>
        </section>

        <section className="mt-6 rounded-[18px] border border-slate-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.05)]">
          <div className="border-b border-slate-200 p-5">
            <div className="grid gap-4 lg:grid-cols-[minmax(260px,1fr)_180px_140px] lg:items-end">
              <div>
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Buscar
                </label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={searchQuery}
                    onChange={(event) => {
                      setSearchQuery(event.target.value);
                      setCurrentPage(1);
                    }}
                    placeholder="Cliente, slug, responsable o estado"
                    className="pl-9"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Estado
                </label>
                <Select
                  value={statusFilter}
                  onChange={(event) => {
                    setStatusFilter(event.target.value as StatusFilter);
                    setCurrentPage(1);
                  }}
                >
                  <option value="active">Activos</option>
                  <option value="all">Todos</option>
                  <option value="inactive">Inactivos</option>
                </Select>
              </div>

              <div>
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Por pagina
                </label>
                <Select
                  value={String(pageSize)}
                  onChange={(event) => {
                    setPageSize(Number(event.target.value) || 10);
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
            </div>

            <p className="mt-4 text-sm text-slate-600">
              Mostrando {pageRangeStart}-{pageRangeEnd} de {filteredClients.length} clientes
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] table-fixed divide-y divide-slate-200 text-left text-sm">
              <colgroup>
                <col className="w-[20%]" />
                <col className="w-[24%]" />
                <col className="w-[20%]" />
                <col className="w-[18%]" />
                <col className="w-[10%]" />
                <col className="w-[8%]" />
              </colgroup>
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-3 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                    Cliente
                  </th>
                  <th className="px-6 py-3 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                    Slug
                  </th>
                  <th className="px-6 py-3 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                    CSM
                  </th>
                  <th className="px-6 py-3 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                    Ventas
                  </th>
                  <th className="px-6 py-3 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                    Estado
                  </th>
                  <th className="px-6 py-3 text-right text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                    Accion
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {paginatedClients.length ? (
                  paginatedClients.map((client) => {
                    const isSaving = savingClientId === client.id;

                    return (
                      <tr key={client.id} className="h-[108px] transition hover:bg-slate-50/70">
                        <td className="px-6 py-4 align-middle">
                          <Link
                            href={`/clients/${client.id}`}
                            className="block truncate font-bold text-slate-950 transition hover:text-[var(--accent-strong)]"
                          >
                            {client.name}
                          </Link>
                        </td>
                        <td className="px-6 py-4 align-middle font-semibold text-slate-500">
                          <span className="block truncate">/{client.slug}</span>
                        </td>
                        <td className="px-6 py-4 align-middle font-medium text-slate-950">
                          {client.csm_name ?? "Sin asignar"}
                        </td>
                        <td className="px-6 py-4 align-middle font-medium text-slate-950">
                          {client.seller_name ?? "Sin asignar"}
                        </td>
                        <td className="px-6 py-4 align-middle">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold",
                              client.is_active
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-rose-50 text-rose-700",
                            )}
                          >
                            {client.is_active ? (
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            ) : (
                              <CircleOff className="h-3.5 w-3.5" />
                            )}
                            {getStatusLabel(client.is_active)}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-center align-middle">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={client.is_active}
                            aria-label={`${client.is_active ? "Desactivar" : "Activar"} ${client.name}`}
                            disabled={isSaving}
                            onClick={() => toggleClientStatus(client)}
                            className={cn(
                              "inline-flex h-8 w-14 items-center rounded-full p-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60",
                              client.is_active ? "bg-[var(--accent)]" : "bg-slate-300",
                            )}
                          >
                            <span
                              className={cn(
                                "h-6 w-6 rounded-full bg-white shadow-sm transition",
                                client.is_active ? "translate-x-6" : "translate-x-0",
                              )}
                            />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center">
                      <p className="font-bold text-slate-900">No hay clientes para mostrar</p>
                      <p className="mt-2 text-sm text-slate-500">
                        Ajusta la busqueda o el filtro de estado.
                      </p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-3 border-t border-slate-200 p-5 lg:flex-row lg:items-center lg:justify-between">
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
        </section>
      </div>

      <FeedbackToast feedback={feedback} onClose={() => setFeedback(null)} />
    </>
  );
}
