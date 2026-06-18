"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ArrowDownAZ, ArrowDownWideNarrow, Search, Table2 } from "lucide-react";

import type { Views } from "@/types/database";

type ClientHealthReportRow = Views<"client_health_report">;
type HealthColor = ClientHealthReportRow["health_color"];
type ReportKey = "client_health" | "customer_success_clients";
type SortKey =
  | "client_name"
  | "health_color"
  | "days_without_progress"
  | "approved_work_remaining"
  | "credits_remaining"
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

const reports: Array<{
  key: ReportKey;
  label: string;
  title: string;
}> = [
  {
    key: "client_health",
    label: "Estado clientes",
    title: "Estado clientes",
  },
  {
    key: "customer_success_clients",
    label: "Clientes por Customer Success",
    title: "Clientes por Customer Success",
  },
];

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-CO").format(value);
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

    return Number(b[sortKey]) - Number(a[sortKey]);
  });
}

export function ReportsPanel({ rows }: { rows: ClientHealthReportRow[] }) {
  const [selectedReportKey, setSelectedReportKey] = useState<ReportKey>("client_health");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("days_without_progress");
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const selectedReport = reports.find((report) => report.key === selectedReportKey) ?? reports[0];

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
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <div className="flex flex-col gap-4 border-b border-[#dfe3eb] pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#00a4bd]">
              Informes
            </p>
            <h1 className="mt-2 text-2xl font-black text-[#213343]">{selectedReport.title}</h1>
          </div>

          <SelectFilter
            compact
            label="Informe"
            value={selectedReportKey}
            onChange={(value) => setSelectedReportKey(value as ReportKey)}
            options={reports.map((report) => [report.key, report.label])}
          />
        </div>

        {selectedReportKey === "client_health" ? (
        <section className="rounded-[6px] border border-[#dfe3eb] bg-white shadow-sm">
          <div className="border-b border-[#dfe3eb] p-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_repeat(4,minmax(150px,180px))]">
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
                label="Creditos"
                value={filters.credits}
                onChange={(value) => setFilter("credits", value as FilterState["credits"])}
                options={[
                  ["all", "Todos"],
                  ["few", "Pocos: 1 o 2"],
                  ["zero", "Cero"],
                ]}
              />
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
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
                  ["days_without_progress", "Dias sin avanzar"],
                  ["approved_work_remaining", "Casos validados"],
                  ["credits_remaining", "Creditos restantes"],
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
                className="mt-[22px] inline-flex h-10 items-center gap-2 rounded-[4px] border border-[#cbd6e2] bg-white px-3 text-sm font-bold text-[#516f90] transition hover:bg-[#f8fbfd]"
              >
                <ArrowDownAZ className="h-4 w-4" />
                Limpiar
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] border-collapse text-left">
              <thead className="bg-[#f8fbfd]">
                <tr className="border-b border-[#dfe3eb]">
                  {[
                    "Cliente",
                    "Customer Success",
                    "Etapa",
                    "Primer caso a tiempo",
                    "Dias sin avanzar",
                    "Casos validados",
                    "Creditos restantes",
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
        </section>
        ) : (
          <CustomerSuccessClientsChart rows={rows} />
        )}
      </div>
    </div>
  );
}

function CustomerSuccessClientsChart({ rows }: { rows: ClientHealthReportRow[] }) {
  const chartRows = useMemo(() => {
    const buckets = new Map<
      string,
      {
        id: string;
        name: string;
        email: string | null;
        total: number;
        green: number;
        yellow: number;
        red: number;
      }
    >();

    rows.forEach((row) => {
      const id = row.customer_success_id ?? "unassigned";
      const current =
        buckets.get(id) ??
        {
          id,
          name: row.customer_success_name || row.customer_success_email || "Sin asignar",
          email: row.customer_success_email,
          total: 0,
          green: 0,
          yellow: 0,
          red: 0,
        };

      current.total += 1;
      current[row.health_color] += 1;
      buckets.set(id, current);
    });

    return [...buckets.values()].sort((first, second) => {
      if (second.total !== first.total) return second.total - first.total;
      return first.name.localeCompare(second.name, "es");
    });
  }, [rows]);

  const maxTotal = Math.max(...chartRows.map((row) => row.total), 1);

  return (
    <section className="rounded-[6px] border border-[#dfe3eb] bg-white shadow-sm">
      <div className="border-b border-[#dfe3eb] p-4">
        <div className="flex flex-wrap items-center gap-4 text-xs font-bold text-[#516f90]">
          <Legend color="bg-emerald-400" label="Verde" />
          <Legend color="bg-amber-400" label="Amarillo" />
          <Legend color="bg-rose-400" label="Rojo" />
        </div>
      </div>

      <div className="divide-y divide-[#edf1f5]">
        {chartRows.map((row) => {
          const barWidth = `${Math.max((row.total / maxTotal) * 100, 6)}%`;
          const greenWidth = `${(row.green / row.total) * 100}%`;
          const yellowWidth = `${(row.yellow / row.total) * 100}%`;
          const redWidth = `${(row.red / row.total) * 100}%`;

          return (
            <div key={row.id} className="grid gap-3 px-4 py-4 lg:grid-cols-[260px_1fr_72px] lg:items-center">
              <div>
                <p className="text-sm font-black text-[#213343]">{row.name}</p>
                {row.email ? (
                  <p className="mt-0.5 text-xs font-semibold text-[#516f90]">{row.email}</p>
                ) : null}
              </div>

              <div className="h-9 rounded-[4px] bg-[#f1f5f9]">
                <div className="flex h-full overflow-hidden rounded-[4px]" style={{ width: barWidth }}>
                  <div className="bg-emerald-400" style={{ width: greenWidth }} />
                  <div className="bg-amber-400" style={{ width: yellowWidth }} />
                  <div className="bg-rose-400" style={{ width: redWidth }} />
                </div>
              </div>

              <div className="text-left lg:text-right">
                <p className="text-xl font-black text-[#213343]">{formatNumber(row.total)}</p>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#99acc2]">
                  Clientes
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="inline-flex items-center gap-2">
      <span className={`h-3 w-3 rounded-full ${color}`} />
      {label}
    </div>
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
    <label className={compact ? "min-w-44 space-y-1.5" : "space-y-1.5"}>
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
