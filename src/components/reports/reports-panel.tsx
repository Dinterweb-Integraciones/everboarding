"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ArrowDownAZ, ArrowDownWideNarrow, CalendarClock, Search, Table2, UsersRound } from "lucide-react";

import type { Views } from "@/types/database";

type ClientHealthReportRow = Views<"client_health_report"> & {
  north_stars_count: number;
  kickoff_completed_at: string | null;
  days_since_kickoff_completed: number | null;
  first_use_case_completed_at: string | null;
  days_to_first_use_case: number | null;
  stagnant_stage_days: number | null;
  evaluation_cases_count: number;
  validated_evaluation_cases_count: number;
};
type HealthColor = ClientHealthReportRow["health_color"];
type PanelKey = "clients" | "customer_success";
type SortKey =
  | "client_name"
  | "health_color"
  | "start_date"
  | "days_without_progress"
  | "approved_work_remaining"
  | "credits_remaining"
  | "north_stars_count"
  | "north_stars_completed";

type FilterState = {
  health: "all" | HealthColor;
  firstCase: "all" | ClientHealthReportRow["first_case_on_time"];
  work: "all" | "little" | "none";
  credits: "all" | "few" | "zero";
  billing: "all" | ClientHealthReportRow["billing"];
  customerSuccess: "all" | string;
};

const rowHealthStyles: Record<HealthColor, string> = {
  green: "bg-emerald-50/55 hover:bg-emerald-50",
  yellow: "bg-amber-50/65 hover:bg-amber-50",
  red: "bg-rose-50/70 hover:bg-rose-50",
};

const rowAccentStyles: Record<HealthColor, string> = {
  green: "border-l-emerald-400",
  yellow: "border-l-amber-400",
  red: "border-l-rose-400",
};

const initialFilters: FilterState = {
  health: "all",
  firstCase: "all",
  work: "all",
  credits: "all",
  billing: "all",
  customerSuccess: "all",
};

const panels: Array<{
  key: PanelKey;
  label: string;
  title: string;
  description: string;
}> = [
  {
    key: "clients",
    label: "Clientes",
    title: "Clientes",
    description: "Seguimiento operativo de clientes, avance, creditos y nortes.",
  },
  {
    key: "customer_success",
    label: "Customer Success",
    title: "Customer Success",
    description: "Reportes del equipo de Customer Success.",
  },
];

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-CO").format(value);
}

function formatDate(value: string) {
  const parsed = new Date(`${value}T00:00:00`);

  if (Number.isNaN(parsed.getTime())) {
    return "Sin fecha";
  }

  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

function compareHealth(a: HealthColor, b: HealthColor) {
  const weight: Record<HealthColor, number> = { red: 0, yellow: 1, green: 2 };
  return weight[a] - weight[b];
}

function applyFilters(row: ClientHealthReportRow, filters: FilterState, searchTerm: string) {
  const normalizedSearch = searchTerm.trim().toLowerCase();

  const searchableText = [
    row.client_name,
    row.customer_success_name,
    row.customer_success_email,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (normalizedSearch && !searchableText.includes(normalizedSearch)) {
    return false;
  }

  if (filters.health !== "all" && row.health_color !== filters.health) return false;
  if (filters.firstCase !== "all" && row.first_case_on_time !== filters.firstCase) return false;
  if (filters.billing !== "all" && row.billing !== filters.billing) return false;
  if (filters.customerSuccess !== "all" && row.customer_success_id !== filters.customerSuccess) {
    return false;
  }

  if (filters.work === "little" && (row.approved_work_remaining < 1 || row.approved_work_remaining > 2)) {
    return false;
  }

  if (filters.work === "none" && row.approved_work_remaining !== 0) return false;
  if (filters.credits === "few" && (row.credits_remaining < 1 || row.credits_remaining > 2)) return false;
  if (filters.credits === "zero" && row.credits_remaining !== 0) return false;

  return true;
}

function sortRows(rows: ClientHealthReportRow[], sortKey: SortKey) {
  return [...rows].sort((a, b) => {
    if (sortKey === "client_name") {
      return a.client_name.localeCompare(b.client_name, "es");
    }

    if (sortKey === "health_color") {
      return compareHealth(a.health_color, b.health_color);
    }

    if (sortKey === "start_date") {
      return new Date(`${b.start_date}T00:00:00`).getTime() - new Date(`${a.start_date}T00:00:00`).getTime();
    }

    return Number(b[sortKey]) - Number(a[sortKey]);
  });
}

export function ReportsPanel({ rows }: { rows: ClientHealthReportRow[] }) {
  const [selectedPanelKey, setSelectedPanelKey] = useState<PanelKey>("clients");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("days_without_progress");
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const selectedPanel = panels.find((panel) => panel.key === selectedPanelKey) ?? panels[0];

  const filteredRows = useMemo(
    () => sortRows(rows.filter((row) => applyFilters(row, filters, searchTerm)), sortKey),
    [filters, rows, searchTerm, sortKey],
  );

  const customerSuccessOptions = useMemo(() => {
    const options = new Map<string, string>();

    rows.forEach((row) => {
      if (row.customer_success_id) {
        options.set(
          row.customer_success_id,
          row.customer_success_name || row.customer_success_email || "Sin nombre",
        );
      }
    });

    return [...options.entries()].sort(([, firstName], [, secondName]) =>
      firstName.localeCompare(secondName, "es"),
    );
  }, [rows]);

  function setFilter<Key extends keyof FilterState>(key: Key, value: FilterState[Key]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="min-h-[calc(100vh-116px)] bg-[#f5f8fb] px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex w-full flex-col gap-5">
        <div className="flex flex-col gap-4 border-b border-[#dfe3eb] pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#00a4bd]">
              Informes
            </p>
            <h1 className="mt-2 text-2xl font-black text-[#213343]">Paneles</h1>
          </div>

          <div className="inline-flex rounded-[4px] border border-[#cbd6e2] bg-white p-1" aria-label="Paneles de informes">
            {panels.map((panel) => (
              <button
                key={panel.key}
                type="button"
                onClick={() => setSelectedPanelKey(panel.key)}
                className={`h-9 rounded-[3px] px-4 text-sm font-black transition ${
                  selectedPanelKey === panel.key
                    ? "bg-[#e5f5f8] text-[#006b7a]"
                    : "text-[#516f90] hover:bg-[#f8fbfd]"
                }`}
              >
                {panel.label}
              </button>
            ))}
          </div>
        </div>

        <section className="border border-[#dfe3eb] bg-[#eef3f7]">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#dfe3eb] bg-white px-4 py-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#00a4bd]">
                Panel
              </p>
              <h2 className="mt-1 text-xl font-black text-[#213343]">{selectedPanel.title}</h2>
              <p className="mt-1 text-sm font-semibold text-[#516f90]">{selectedPanel.description}</p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-right sm:grid-cols-3">
              <div>
                <p className="text-lg font-black text-[#213343]">{formatNumber(rows.length)}</p>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#99acc2]">Clientes</p>
              </div>
              <div>
                <p className="text-lg font-black text-[#213343]">{formatNumber(filteredRows.length)}</p>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#99acc2]">Filtrados</p>
              </div>
              <div>
                <p className="text-lg font-black text-[#213343]">{formatNumber(rows.reduce((sum, row) => sum + row.north_stars_count, 0))}</p>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#99acc2]">Nortes</p>
              </div>
            </div>
          </div>

          {selectedPanelKey === "clients" ? (
            <div className="grid gap-4 p-4 xl:grid-cols-2">
              <article className="overflow-hidden rounded-[6px] border border-[#dfe3eb] bg-white shadow-sm xl:col-span-2">
              <div className="border-b border-[#dfe3eb] p-4">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-black text-[#213343]">Clientes</h3>
                    <p className="mt-1 text-xs font-semibold text-[#516f90]">
                      Estado operativo, avance, creditos y nortes por cliente.
                    </p>
                  </div>
                  <span className="rounded-[999px] bg-[#f5f8fa] px-3 py-1 text-xs font-black text-[#516f90]">
                    {formatNumber(filteredRows.length)} clientes
                  </span>
                </div>

                <div className="grid gap-3 xl:grid-cols-[320px_repeat(7,minmax(128px,1fr))_112px] xl:items-end">
              <label className="space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#99acc2]">
                  Buscar cliente
                </span>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#516f90]" />
                  <input
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    className="h-10 w-full rounded-[4px] border border-[#cbd6e2] bg-white pl-9 pr-3 text-sm font-semibold text-[#33475b] outline-none transition focus:border-[#00a4bd] focus:ring-2 focus:ring-[#00a4bd]/15"
                    placeholder="Nombre"
                  />
                </div>
              </label>

              <SelectFilter
                compact
                label="Semaforo"
                value={filters.health}
                onChange={(value) => setFilter("health", value as FilterState["health"])}
                options={[
                  ["all", "Todos"],
                  ["red", "Rojo"],
                  ["yellow", "Amarillo"],
                  ["green", "Verde"],
                ]}
              />

              <SelectFilter
                compact
                label="Primer caso a tiempo"
                value={filters.firstCase}
                onChange={(value) => setFilter("firstCase", value as FilterState["firstCase"])}
                options={[
                  ["all", "Todos"],
                  ["en riesgo", "En riesgo"],
                  ["no", "No"],
                  ["si", "Sí"],
                ]}
              />

              <SelectFilter
                compact
                label="Casos validados"
                value={filters.work}
                onChange={(value) => setFilter("work", value as FilterState["work"])}
                options={[
                  ["all", "Todos"],
                  ["little", "Poco: 1 o 2"],
                  ["none", "Cero"],
                ]}
              />

              <SelectFilter
                compact
                label="Creditos"
                value={filters.credits}
                onChange={(value) => setFilter("credits", value as FilterState["credits"])}
                options={[
                  ["all", "Todos"],
                  ["few", "Pocos: 1 o 2"],
                  ["zero", "Cero"],
                ]}
              />

              <SelectFilter
                compact
                label="Customer Success"
                value={filters.customerSuccess}
                onChange={(value) => setFilter("customerSuccess", value)}
                options={[
                  ["all", "Todos los CS"],
                  ...customerSuccessOptions,
                ]}
              />

              <SelectFilter
                compact
                label="Facturacion"
                value={filters.billing}
                onChange={(value) => setFilter("billing", value as FilterState["billing"])}
                options={[
                  ["all", "Toda facturacion"],
                  ["paquetes", "Paquetes"],
                  ["recurrencia", "Recurrencia"],
                ]}
              />

              <SelectFilter
                compact
                label="Orden"
                value={sortKey}
                onChange={(value) => setSortKey(value as SortKey)}
                icon={<ArrowDownWideNarrow className="h-4 w-4" />}
                options={[
                  ["start_date", "Fecha de inicio"],
                  ["days_without_progress", "Dias sin avanzar"],
                  ["approved_work_remaining", "Casos validados"],
                  ["credits_remaining", "Creditos restantes"],
                  ["north_stars_count", "Cantidad de nortes"],
                  ["north_stars_completed", "Norte definido"],
                  ["health_color", "Semaforo"],
                  ["client_name", "Cliente A-Z"],
                ]}
              />

              <button
                type="button"
                onClick={() => {
                  setFilters(initialFilters);
                  setSearchTerm("");
                }}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-[4px] border border-[#ffb49f] bg-[#fff3ee] px-3 text-sm font-bold text-[#c2410c] transition hover:bg-[#ffe4dc]"
              >
                <ArrowDownAZ className="h-4 w-4" />
                Limpiar
              </button>
                </div>
            </div>

              <div className="overflow-x-auto">
            <table className="w-full min-w-[1360px] border-collapse text-left">
              <thead className="bg-[#f8fbfd]">
                <tr className="border-b border-[#dfe3eb]">
                  {[
                    "Cliente",
                    "Fecha de inicio",
                    "Customer Success",
                    "Etapa",
                    "Primer caso a tiempo",
                    "Dias sin avanzar",
                    "Casos validados",
                    "Creditos restantes",
                    "Cantidad de nortes",
                    "Norte definido",
                    "Facturacion",
                  ].map((header) => (
                    <th
                      key={header}
                      className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.14em] text-[#516f90]"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr
                    key={row.client_id}
                    className={`border-b border-[#edf1f5] transition last:border-b-0 ${rowHealthStyles[row.health_color]}`}
                  >
                    <td className={`border-l-4 px-4 py-4 ${rowAccentStyles[row.health_color]}`}>
                      <a
                        href={`/clients/${row.client_id}`}
                        className="text-sm font-black text-[#213343] hover:text-[#00a4bd]"
                      >
                        {row.client_name}
                      </a>
                    </td>
                    <td className="px-4 py-4 text-sm font-semibold text-[#33475b]">
                      {formatDate(row.start_date)}
                    </td>
                    <td className="px-4 py-4">
                      <div className="text-sm font-bold text-[#33475b]">
                        {row.customer_success_name || "Sin asignar"}
                      </div>
                      {row.customer_success_email ? (
                        <div className="mt-0.5 text-xs font-semibold text-[#516f90]">
                          {row.customer_success_email}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-4 text-sm font-bold capitalize text-[#33475b]">
                      {row.stage}
                    </td>
                    <td className="px-4 py-4">
                      <StatusPill value={row.first_case_on_time} />
                    </td>
                    <td className="px-4 py-4 text-sm font-semibold text-[#33475b]">
                      {formatNumber(row.days_without_progress)}
                    </td>
                    <td className="px-4 py-4 text-sm font-semibold text-[#33475b]">
                      {formatNumber(row.approved_work_remaining)}
                    </td>
                    <td className="px-4 py-4 text-sm font-semibold text-[#33475b]">
                      {formatNumber(row.credits_remaining)}
                    </td>
                    <td className="px-4 py-4 text-sm font-semibold text-[#33475b]">
                      {formatNumber(row.north_stars_count)}
                    </td>
                    <td className="px-4 py-4">
                      <StatusPill value={row.north_stars_completed > 0 ? "si" : "no"} />
                    </td>
                    <td className="px-4 py-4 text-sm font-bold capitalize text-[#33475b]">
                      {row.billing}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
              </div>

              {filteredRows.length === 0 ? (
            <div className="flex min-h-48 flex-col items-center justify-center gap-3 px-4 py-12 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-[4px] border border-[#dfe3eb] bg-white text-[#516f90]">
                <Table2 className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-black text-[#213343]">Sin clientes para estos filtros</p>
                <p className="mt-1 text-sm font-medium text-[#516f90]">
                  Cambia el filtro o limpia la busqueda para volver a ver el informe completo.
                </p>
              </div>
            </div>
              ) : null}
              </article>

              <KickoffWindowReport
                rows={rows}
                title="Dentro de 14 dias"
                description="Clientes con Kickoff completado hace menos de 14 dias y primer caso de uso pendiente."
                emptyTitle="Sin clientes dentro de esta ventana"
                emptyDescription="No hay clientes con Kickoff completado hace menos de 14 dias y primer caso pendiente."
                rowFilter={(row) =>
                  row.days_since_kickoff_completed !== null &&
                  row.days_since_kickoff_completed < 14
                }
                barTone="bg-[#00a4bd]"
                getSecondaryLabel={(days) => `${formatNumber(Math.max(14 - days, 0))} restantes`}
              />

              <KickoffWindowReport
                rows={rows}
                title="Fuera de 14 dias"
                description="Clientes con Kickoff completado hace mas de 14 dias y primer caso de uso pendiente."
                emptyTitle="Sin clientes fuera de esta ventana"
                emptyDescription="No hay clientes con Kickoff completado hace mas de 14 dias y primer caso pendiente."
                rowFilter={(row) =>
                  row.days_since_kickoff_completed !== null &&
                  row.days_since_kickoff_completed > 14
                }
                barTone="bg-[#f97316]"
                getSecondaryLabel={(days) => `${formatNumber(Math.max(days - 14, 0))} dias fuera`}
              />

              <FirstCaseCompletionReport
                rows={rows}
                title="Logrados en 14 dias"
                description="Clientes que cumplieron su primer caso de uso en menos de 14 dias desde Kickoff completado."
                emptyTitle="Sin clientes logrados en esta ventana"
                emptyDescription="No hay clientes con primer caso completado en menos de 14 dias desde Kickoff."
                rowFilter={(row) => row.days_to_first_use_case !== null && row.days_to_first_use_case < 14}
                barTone="bg-[#22c55e]"
              />

              <FirstCaseCompletionReport
                rows={rows}
                title="Incumplidos en 14 dias"
                description="Clientes que cumplieron su primer caso de uso en mas de 14 dias desde Kickoff completado."
                emptyTitle="Sin clientes incumplidos en esta ventana"
                emptyDescription="No hay clientes con primer caso completado en mas de 14 dias desde Kickoff."
                rowFilter={(row) => row.days_to_first_use_case !== null && row.days_to_first_use_case > 14}
                barTone="bg-[#ef4444]"
              />

              <ClientMetricBarsReport
                rows={rows}
                title="Clientes estancados"
                description="Clientes activos con casos de uso que llevan mas de 7 dias en la misma etapa."
                emptyTitle="Sin clientes estancados"
                emptyDescription="No hay clientes activos con casos de uso por encima de 7 dias en la misma etapa."
                rowFilter={(row) => row.stagnant_stage_days !== null && row.stagnant_stage_days > 7}
                getValue={(row) => row.stagnant_stage_days ?? 0}
                getMeta={(row) => `${formatNumber(row.stagnant_stage_days ?? 0)} dias en etapa actual`}
                valueLabel="Dias"
                barTone="bg-[#8b5cf6]"
                sortDirection="desc"
              />

              <ClientMetricBarsReport
                rows={rows}
                title="Casos en Evaluacion"
                description="Clientes activos con menos de 3 casos de uso en la etapa En Evaluacion."
                emptyTitle="Sin clientes bajo el minimo"
                emptyDescription="No hay clientes activos con menos de 3 casos de uso en evaluacion."
                rowFilter={(row) => row.evaluation_cases_count < 3}
                getValue={(row) => row.evaluation_cases_count}
                getMeta={(row) => `${formatNumber(row.evaluation_cases_count)} casos en evaluacion`}
                valueLabel="Casos"
                barTone="bg-[#00a4bd]"
                maxValue={3}
                sortDirection="asc"
              />

              <ClientMetricBarsReport
                rows={rows}
                title="Casos validados en Evaluacion"
                description="Clientes activos con menos de 3 casos de uso validados en la etapa En Evaluacion."
                emptyTitle="Sin clientes bajo el minimo"
                emptyDescription="No hay clientes activos con menos de 3 casos validados en evaluacion."
                rowFilter={(row) => row.validated_evaluation_cases_count < 3}
                getValue={(row) => row.validated_evaluation_cases_count}
                getMeta={(row) => `${formatNumber(row.validated_evaluation_cases_count)} validados en evaluacion`}
                valueLabel="Casos"
                barTone="bg-[#14b8a6]"
                maxValue={3}
                sortDirection="asc"
              />
            </div>
          ) : (
            <div className="p-4">
              <article className="flex min-h-72 flex-col items-center justify-center rounded-[6px] border border-dashed border-[#cbd6e2] bg-white px-6 py-12 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-[6px] border border-[#dfe3eb] bg-[#f5f8fa] text-[#516f90]">
                  <UsersRound className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-base font-black text-[#213343]">Panel sin reportes</h3>
                <p className="mt-2 max-w-md text-sm font-semibold text-[#516f90]">
                  Este panel queda reservado para los proximos reportes de Customer Success.
                </p>
              </article>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function KickoffWindowReport({
  rows,
  title,
  description,
  emptyTitle,
  emptyDescription,
  rowFilter,
  barTone,
  getSecondaryLabel,
}: {
  rows: ClientHealthReportRow[];
  title: string;
  description: string;
  emptyTitle: string;
  emptyDescription: string;
  rowFilter: (row: ClientHealthReportRow) => boolean;
  barTone: string;
  getSecondaryLabel: (days: number) => string;
}) {
  const chartRows = useMemo(
    () =>
      rows
        .filter(
          (row) =>
            row.first_use_case_completed_at === null &&
            rowFilter(row),
        )
        .sort(
          (first, second) =>
            Number(second.days_since_kickoff_completed ?? 0) -
            Number(first.days_since_kickoff_completed ?? 0),
        ),
    [rowFilter, rows],
  );

  const maxDays = Math.max(...chartRows.map((row) => row.days_since_kickoff_completed ?? 0), 14);

  return (
    <article className="rounded-[6px] border border-[#dfe3eb] bg-white shadow-sm">
      <div className="border-b border-[#dfe3eb] p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-black text-[#213343]">{title}</h3>
            <p className="mt-1 text-xs font-semibold text-[#516f90]">
              {description}
            </p>
          </div>
          <span className="rounded-[999px] bg-[#f5f8fa] px-3 py-1 text-xs font-black text-[#516f90]">
            {formatNumber(chartRows.length)} clientes
          </span>
        </div>
      </div>

      {chartRows.length ? (
        <div className="divide-y divide-[#edf1f5]">
          {chartRows.map((row) => {
            const days = row.days_since_kickoff_completed ?? 0;
            const progress = Math.min(Math.max((days / maxDays) * 100, 4), 100);

            return (
              <div key={row.client_id} className="grid gap-3 px-4 py-4 lg:grid-cols-[260px_1fr_96px] lg:items-center">
                <div>
                  <a
                    href={`/clients/${row.client_id}`}
                    className="text-sm font-black text-[#213343] hover:text-[#00a4bd]"
                  >
                    {row.client_name}
                  </a>
                  <p className="mt-0.5 text-xs font-semibold text-[#516f90]">
                    Kickoff: {row.kickoff_completed_at ? formatDate(row.kickoff_completed_at.slice(0, 10)) : "Sin fecha"}
                  </p>
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.12em] text-[#99acc2]">
                    <span>{formatNumber(days)} dias</span>
                    <span>{getSecondaryLabel(days)}</span>
                  </div>
                  <div className="h-9 overflow-hidden rounded-[4px] bg-[#f1f5f9]">
                    <div
                      className={`flex h-full items-center justify-end rounded-[4px] px-2 text-xs font-black text-white ${barTone}`}
                      style={{ width: `${progress}%` }}
                    >
                      {formatNumber(days)}
                    </div>
                  </div>
                </div>

                <div className="text-left lg:text-right">
                  <p className="text-xl font-black text-[#213343]">{formatNumber(days)}</p>
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#99acc2]">
                    Dias
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex min-h-56 flex-col items-center justify-center px-6 py-10 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-[6px] border border-[#dfe3eb] bg-[#f5f8fa] text-[#516f90]">
            <CalendarClock className="h-5 w-5" />
          </div>
          <p className="mt-3 text-sm font-black text-[#213343]">{emptyTitle}</p>
          <p className="mt-1 max-w-sm text-sm font-semibold text-[#516f90]">
            {emptyDescription}
          </p>
        </div>
      )}
    </article>
  );
}

function FirstCaseCompletionReport({
  rows,
  title,
  description,
  emptyTitle,
  emptyDescription,
  rowFilter,
  barTone,
}: {
  rows: ClientHealthReportRow[];
  title: string;
  description: string;
  emptyTitle: string;
  emptyDescription: string;
  rowFilter: (row: ClientHealthReportRow) => boolean;
  barTone: string;
}) {
  const chartRows = useMemo(
    () =>
      rows
        .filter(
          (row) =>
            row.kickoff_completed_at !== null &&
            row.first_use_case_completed_at !== null &&
            rowFilter(row),
        )
        .sort(
          (first, second) =>
            Number(second.days_to_first_use_case ?? 0) -
            Number(first.days_to_first_use_case ?? 0),
        ),
    [rowFilter, rows],
  );

  const maxDays = Math.max(...chartRows.map((row) => row.days_to_first_use_case ?? 0), 14);

  return (
    <article className="rounded-[6px] border border-[#dfe3eb] bg-white shadow-sm">
      <div className="border-b border-[#dfe3eb] p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-black text-[#213343]">{title}</h3>
            <p className="mt-1 text-xs font-semibold text-[#516f90]">
              {description}
            </p>
          </div>
          <span className="rounded-[999px] bg-[#f5f8fa] px-3 py-1 text-xs font-black text-[#516f90]">
            {formatNumber(chartRows.length)} clientes
          </span>
        </div>
      </div>

      {chartRows.length ? (
        <div className="divide-y divide-[#edf1f5]">
          {chartRows.map((row) => {
            const days = row.days_to_first_use_case ?? 0;
            const progress = Math.min(Math.max((days / maxDays) * 100, 4), 100);

            return (
              <div key={row.client_id} className="grid gap-3 px-4 py-4 lg:grid-cols-[260px_1fr_96px] lg:items-center">
                <div>
                  <a
                    href={`/clients/${row.client_id}`}
                    className="text-sm font-black text-[#213343] hover:text-[#00a4bd]"
                  >
                    {row.client_name}
                  </a>
                  <p className="mt-0.5 text-xs font-semibold text-[#516f90]">
                    Primer caso:{" "}
                    {row.first_use_case_completed_at
                      ? formatDate(row.first_use_case_completed_at.slice(0, 10))
                      : "Sin fecha"}
                  </p>
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.12em] text-[#99acc2]">
                    <span>{formatNumber(days)} dias</span>
                    <span>desde Kickoff</span>
                  </div>
                  <div className="h-9 overflow-hidden rounded-[4px] bg-[#f1f5f9]">
                    <div
                      className={`flex h-full items-center justify-end rounded-[4px] px-2 text-xs font-black text-white ${barTone}`}
                      style={{ width: `${progress}%` }}
                    >
                      {formatNumber(days)}
                    </div>
                  </div>
                </div>

                <div className="text-left lg:text-right">
                  <p className="text-xl font-black text-[#213343]">{formatNumber(days)}</p>
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#99acc2]">
                    Dias
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex min-h-56 flex-col items-center justify-center px-6 py-10 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-[6px] border border-[#dfe3eb] bg-[#f5f8fa] text-[#516f90]">
            <CalendarClock className="h-5 w-5" />
          </div>
          <p className="mt-3 text-sm font-black text-[#213343]">{emptyTitle}</p>
          <p className="mt-1 max-w-sm text-sm font-semibold text-[#516f90]">
            {emptyDescription}
          </p>
        </div>
      )}
    </article>
  );
}

function ClientMetricBarsReport({
  rows,
  title,
  description,
  emptyTitle,
  emptyDescription,
  rowFilter,
  getValue,
  getMeta,
  valueLabel,
  barTone,
  maxValue,
  sortDirection,
}: {
  rows: ClientHealthReportRow[];
  title: string;
  description: string;
  emptyTitle: string;
  emptyDescription: string;
  rowFilter: (row: ClientHealthReportRow) => boolean;
  getValue: (row: ClientHealthReportRow) => number;
  getMeta: (row: ClientHealthReportRow) => string;
  valueLabel: string;
  barTone: string;
  maxValue?: number;
  sortDirection: "asc" | "desc";
}) {
  const chartRows = useMemo(
    () =>
      rows
        .filter(rowFilter)
        .sort((first, second) => {
          const delta = getValue(first) - getValue(second);
          return sortDirection === "asc" ? delta : -delta;
        }),
    [getValue, rowFilter, rows, sortDirection],
  );
  const resolvedMaxValue = Math.max(maxValue ?? 0, ...chartRows.map(getValue), 1);

  return (
    <article className="rounded-[6px] border border-[#dfe3eb] bg-white shadow-sm">
      <div className="border-b border-[#dfe3eb] p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-black text-[#213343]">{title}</h3>
            <p className="mt-1 text-xs font-semibold text-[#516f90]">{description}</p>
          </div>
          <span className="rounded-[999px] bg-[#f5f8fa] px-3 py-1 text-xs font-black text-[#516f90]">
            {formatNumber(chartRows.length)} clientes
          </span>
        </div>
      </div>

      {chartRows.length ? (
        <div className="divide-y divide-[#edf1f5]">
          {chartRows.map((row) => {
            const value = getValue(row);
            const progress = Math.min(Math.max((value / resolvedMaxValue) * 100, value === 0 ? 2 : 4), 100);

            return (
              <div key={row.client_id} className="grid gap-3 px-4 py-4 lg:grid-cols-[260px_1fr_96px] lg:items-center">
                <div>
                  <a
                    href={`/clients/${row.client_id}`}
                    className="text-sm font-black text-[#213343] hover:text-[#00a4bd]"
                  >
                    {row.client_name}
                  </a>
                  <p className="mt-0.5 text-xs font-semibold text-[#516f90]">{getMeta(row)}</p>
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.12em] text-[#99acc2]">
                    <span>{formatNumber(value)} {valueLabel.toLowerCase()}</span>
                    <span>{sortDirection === "asc" ? "menor primero" : "mayor primero"}</span>
                  </div>
                  <div className="h-9 overflow-hidden rounded-[4px] bg-[#f1f5f9]">
                    <div
                      className={`flex h-full items-center justify-end rounded-[4px] px-2 text-xs font-black text-white ${barTone}`}
                      style={{ width: `${progress}%` }}
                    >
                      {formatNumber(value)}
                    </div>
                  </div>
                </div>

                <div className="text-left lg:text-right">
                  <p className="text-xl font-black text-[#213343]">{formatNumber(value)}</p>
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#99acc2]">
                    {valueLabel}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex min-h-56 flex-col items-center justify-center px-6 py-10 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-[6px] border border-[#dfe3eb] bg-[#f5f8fa] text-[#516f90]">
            <CalendarClock className="h-5 w-5" />
          </div>
          <p className="mt-3 text-sm font-black text-[#213343]">{emptyTitle}</p>
          <p className="mt-1 max-w-sm text-sm font-semibold text-[#516f90]">{emptyDescription}</p>
        </div>
      )}
    </article>
  );
}


function SelectFilter({
  label,
  value,
  options,
  onChange,
  compact = false,
  icon,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
  compact?: boolean;
  icon?: ReactNode;
}) {
  return (
    <label className={compact ? "min-w-0 space-y-1.5" : "space-y-1.5"}>
      <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#99acc2]">
        {label}
      </span>
      <div className="relative">
        {icon ? <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#516f90]">{icon}</span> : null}
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`h-10 w-full appearance-none rounded-[4px] border border-[#cbd6e2] bg-white px-3 text-sm font-bold text-[#33475b] outline-none transition focus:border-[#00a4bd] focus:ring-2 focus:ring-[#00a4bd]/15 ${
            icon ? "pl-9" : ""
          }`}
        >
          {options.map(([optionValue, optionLabel]) => (
            <option key={optionValue} value={optionValue}>
              {optionLabel}
            </option>
          ))}
        </select>
      </div>
    </label>
  );
}

function StatusPill({ value }: { value: ClientHealthReportRow["first_case_on_time"] }) {
  const label = value === "si" ? "Sí" : value;
  const className =
    value === "si"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : value === "en riesgo"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-rose-200 bg-rose-50 text-rose-700";

  return (
    <span className={`inline-flex h-8 items-center rounded-[4px] border px-2.5 text-xs font-black ${className}`}>
      {label}
    </span>
  );
}
