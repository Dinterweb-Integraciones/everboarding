"use client";

import { useDeferredValue, useMemo, useState } from "react";

import { ClientCard } from "@/components/dashboard/client-card";
import { ClientGameplanModal } from "@/components/dashboard/client-gameplan-modal";
import { ClientShareModal } from "@/components/dashboard/client-share-modal";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ACCESS_ROLE_META } from "@/lib/constants";
import type { ClientSummary } from "@/lib/onboarding";

type ClientsDashboardProps = {
  initialClients: ClientSummary[];
  customerSuccessOptions?: Array<{ id: string; name: string }>;
  showCustomerSuccessFilter?: boolean;
};

const PAGE_SIZE_OPTIONS = [9, 18, 36];

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function ClientsDashboard({
  initialClients,
  customerSuccessOptions = [],
  showCustomerSuccessFilter = false,
}: ClientsDashboardProps) {
  const [clients, setClients] = useState(initialClients);
  const [error, setError] = useState<string | null>(null);
  const [sharingClient, setSharingClient] = useState<ClientSummary | null>(null);
  const [gameplanClient, setGameplanClient] = useState<ClientSummary | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [customerSuccessFilter, setCustomerSuccessFilter] = useState("all");
  const [pageSize, setPageSize] = useState(9);
  const [currentPage, setCurrentPage] = useState(1);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const hasUnassignedClients = useMemo(
    () => clients.some((client) => !client.csm_user_id),
    [clients],
  );

  const filteredClients = useMemo(() => {
    const normalizedQuery = normalizeSearchText(deferredSearchQuery);
    return clients.filter((client) => {
      if (customerSuccessFilter === "unassigned" && client.csm_user_id) {
        return false;
      }

      if (
        customerSuccessFilter !== "all" &&
        customerSuccessFilter !== "unassigned" &&
        client.csm_user_id !== customerSuccessFilter
      ) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      const searchableText = [
        client.name,
        client.description ?? "",
        ACCESS_ROLE_META[client.access_role].label,
      ].join(" ");

      return normalizeSearchText(searchableText).includes(normalizedQuery);
    });
  }, [clients, customerSuccessFilter, deferredSearchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredClients.length / pageSize));
  const activePage = Math.min(currentPage, totalPages);

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

  const pageRangeStart = filteredClients.length === 0 ? 0 : (activePage - 1) * pageSize + 1;
  const pageRangeEnd = Math.min(activePage * pageSize, filteredClients.length);

  async function handleDelete(client: ClientSummary) {
    const confirmed = window.confirm(
      `Se eliminara el cliente "${client.name}" y todo su onboarding. Esta accion no se puede deshacer.`,
    );

    if (!confirmed) {
      return;
    }

    setError(null);
    const response = await fetch(`/api/clients?id=${client.id}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const payload = await response.json();
      setError(payload.message || "No fue posible eliminar el cliente.");
      return;
    }

    setClients((current) => current.filter((item) => item.id !== client.id));
  }

  return (
    <div className="space-y-6 px-4 py-6 sm:px-6">
      {error ? (
        <Card className="p-6">
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        </Card>
      ) : null}

      <Card className="p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid w-full gap-3 lg:max-w-4xl lg:grid-cols-[minmax(280px,1fr)_260px] lg:items-end">
            <div>
              <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                Buscar cliente
              </label>
              <Input
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Buscar por nombre, descripcion o nivel de acceso"
              />
            </div>

            {showCustomerSuccessFilter ? (
              <div>
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Customer Success
                </label>
                <Select
                  value={customerSuccessFilter}
                  onChange={(event) => {
                    setCustomerSuccessFilter(event.target.value);
                    setCurrentPage(1);
                  }}
                >
                  <option value="all">Todos los CS</option>
                  {customerSuccessOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                  {hasUnassignedClients ? <option value="unassigned">Sin asignar</option> : null}
                </Select>
              </div>
            ) : null}
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
              Mostrando {pageRangeStart}-{pageRangeEnd} de {filteredClients.length} clientes
            </p>
          </div>
        </div>
      </Card>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {paginatedClients.length ? (
          paginatedClients.map((client) => (
            <ClientCard
              key={client.id}
              client={client}
              onDelete={handleDelete}
              onShare={setSharingClient}
              onGameplan={setGameplanClient}
              canDelete={client.access_role === "owner"}
              canShare={client.access_role === "owner"}
            />
          ))
        ) : (
          <Card className="p-6 md:col-span-2 xl:col-span-3">
            {filteredClients.length === 0 && searchQuery ? (
              <>
                <h3 className="text-lg font-semibold text-slate-950">No encontramos clientes</h3>
                <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-600">
                  Ajusta el buscador para encontrar mas rapido el onboarding que necesitas.
                </p>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold text-slate-950">Aun no hay clientes en CS</h3>
                <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-600">
                  Cuando una venta se cierre y el cliente entre al flujo comercial, lo veras reflejado aqui para continuar su onboarding.
                </p>
              </>
            )}
          </Card>
        )}
      </section>

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

      {sharingClient ? (
        <ClientShareModal
          clientId={sharingClient.id}
          clientName={sharingClient.name}
          isOpen
          onClose={() => setSharingClient(null)}
        />
      ) : null}

      {gameplanClient ? (
        <ClientGameplanModal
          clientId={gameplanClient.id}
          clientName={gameplanClient.name}
          isOpen
          onClose={() => setGameplanClient(null)}
        />
      ) : null}
    </div>
  );
}
