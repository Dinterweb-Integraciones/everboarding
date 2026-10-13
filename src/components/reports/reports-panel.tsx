"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  ArrowDownAZ,
  ArrowDownWideNarrow,
  ArrowUpDown,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CircleHelp,
  MessageSquarePlus,
  MessageSquareText,
  Pencil,
  Search,
  Table2,
  Target,
  UsersRound,
  X,
} from "lucide-react";

import {
  buildCreditHistoryRows,
  type CreditBreakdownItem,
  type CreditBreakdownKey,
  type CreditHistoryReportRow,
} from "@/lib/credit-history-report";
import { formatMonthLabel, type MonthlyGoalProgress } from "@/lib/cs-monthly-goals";
import { getEvaluationValidationLabel } from "@/lib/onboarding";
import type { Views } from "@/types/database";
import {
  OperationalDashboard,
  type OperationalTaskRow,
  type OperationalTransitionClientRow,
} from "./operational-dashboard";
import { NorthFulfillmentReport } from "./north-fulfillment-report";

type ClientHealthReportRow = Views<"client_health_report"> & {
  north_stars_count: number;
  kickoff_completed_at: string | null;
  days_since_kickoff_completed: number | null;
  first_use_case_completed_at: string | null;
  days_to_first_use_case: number | null;
  stagnant_stage_days: number | null;
  evaluation_cases_count: number;
  validated_evaluation_cases_count: number;
  contracted_credits: number;
  contracted_credits_period_months: number;
  // Caudal: consumo mensual definido comercialmente. Null mientras no se defina.
  flow_credits: number | null;
  current_cycle_start_at: string;
  current_cycle_end_at: string | null;
  is_active: boolean;
  observations: string | null;
  cycle_colors: CycleColumnColors | null;
};
type CycleColumnColor = "verde" | "naranja" | "rojo" | "gris";
type CycleColumnColors = { available: CycleColumnColor; committed: CycleColumnColor; evaluation: CycleColumnColor };
type HealthColor = ClientHealthReportRow["health_color"];
type PanelKey = "clients" | "credit_history" | "customer_success" | "operational" | "norths";
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

type InitiativeReportRow = {
  id: string;
  client_id: string;
  title: string;
  type: string | null;
  labels: string[];
  status: "backlog" | "planned" | "executing" | "completed";
  north_star_history_id: string | null;
  created_at: string;
  updated_at: string;
  // Fecha en que el caso entró a su etapa actual (Planificado / En ejecución).
  stage_entered_at: string;
  executing_at: string | null;
  completed_at: string | null;
  // Valor operativo del trabajo; incluye bonificados a su valor de catálogo.
  credits: number;
};

type CustomerSuccessConfigRow = {
  client_id: string;
  north_star_text: string | null;
  north_star_status: "pending" | "cs_preapproved" | "client_approved" | "completed";
  north_star_lifecycle_status: "active" | "inactive" | "fulfilled";
};

type CustomerSuccessCreditGrantRow = {
  client_id: string;
  granted_credits: number;
  used_credits: number;
  expired_credits: number;
  grant_date: string;
  expires_at: string;
};
type CustomerSuccessProfileRow = {
  id: string;
  full_name: string | null;
  email: string;
};
type NorthHistoryRow = { id: string; client_id: string; north_star_text: string; north_star_status: "pending" | "cs_preapproved" | "client_approved" | "completed"; north_star_lifecycle_status: "active" | "inactive" | "fulfilled"; created_at: string };
type NorthAudit = { north_star_history_id: string; is_from: boolean; is_until: boolean; is_timed: boolean; is_crucial: boolean; has_associated_use_cases: boolean; notes: string };

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
  // Vacío: el panel se muestra sin subtítulo.
  description: string;
}> = [
  {
    key: "clients",
    label: "Clientes",
    title: "Clientes",
    description: "Seguimiento operativo de clientes, avance, créditos y nortes.",
  },
  {
    key: "credit_history",
    label: "Operaciones",
    title: "Operaciones",
    description: "",
  },
  {
    key: "customer_success",
    label: "Customer Success",
    title: "Customer Success",
    description: "Reportes del equipo de Customer Success.",
  },
  {
    key: "operational",
    label: "Operativo",
    title: "Operativo",
    description: "Producción, carga, cumplimiento y movimiento del equipo CS con los datos actuales.",
  },
  { key: "norths", label: "Nortes", title: "Nortes", description: "Auditoría, calidad y antigüedad de los Nortes." },
];

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-CO").format(value);
}

function InfoTooltip({ children }: { children: ReactNode }) {
  return (
    <span className="group relative inline-flex cursor-help align-middle">
      <CircleHelp className="h-4 w-4 text-[#99acc2]" aria-hidden="true" />
      <span role="tooltip" className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-72 -translate-x-1/2 rounded-[4px] bg-[#213343] px-3 py-2 text-xs font-semibold leading-relaxed text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {children}
      </span>
    </span>
  );
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

export function ReportsPanel({
  rows,
  initiatives,
  operationsRows,
  operationsInitiatives,
  operationsCreditGrants,
  monthlyGoalProgress,
  operationalTasks,
  operationalTransitionClients,
  customerSuccessConfigs,
  customerSuccessCreditGrants,
  customerSuccessProfiles,
  northStarHistory,
  northStarAudits,
  canAuditNorths = true,
  isCustomerSuccess = false,
  canEditObservations = false,
}: {
  // Solo clientes activos; alimenta todos los paneles salvo Operaciones.
  rows: ClientHealthReportRow[];
  initiatives: InitiativeReportRow[];
  // Clientes activos e inactivos, con sus casos de uso y créditos, para Operaciones.
  operationsRows: ClientHealthReportRow[];
  operationsInitiatives: InitiativeReportRow[];
  operationsCreditGrants: CustomerSuccessCreditGrantRow[];
  // Avance contra la meta mensual por CS (últimos 12 meses), calculado en el servidor. Para un CS
  // solo trae su fila y el total global, sin el detalle de clientes ajenos.
  monthlyGoalProgress: MonthlyGoalProgress[];
  operationalTasks: OperationalTaskRow[];
  operationalTransitionClients: OperationalTransitionClientRow[];
  customerSuccessConfigs: CustomerSuccessConfigRow[];
  customerSuccessCreditGrants: CustomerSuccessCreditGrantRow[];
  customerSuccessProfiles: CustomerSuccessProfileRow[];
  northStarHistory: NorthHistoryRow[];
  northStarAudits: Array<Record<string, unknown>>;
  canAuditNorths?: boolean;
  isCustomerSuccess?: boolean;
  // Solo superadmin edita las observaciones del cliente desde Operaciones.
  canEditObservations?: boolean;
}) {
  const [panelKeyState, setSelectedPanelKey] = useState<PanelKey>("clients");
  // Customer Success solo ve el panel de clientes.
  const selectedPanelKey: PanelKey = isCustomerSuccess ? "clients" : panelKeyState;
  const [searchTerm, setSearchTerm] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("days_without_progress");
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const selectedPanel = panels.find((panel) => panel.key === selectedPanelKey) ?? panels[0];

  const filteredRows = useMemo(
    () => sortRows(rows.filter((row) => applyFilters(row, filters, searchTerm)), sortKey),
    [filters, rows, searchTerm, sortKey],
  );
  const clientReportRows = useMemo(
    () =>
      filters.customerSuccess === "all"
        ? rows
        : rows.filter((row) => row.customer_success_id === filters.customerSuccess),
    [filters.customerSuccess, rows],
  );
  const activeNorthStarsCount = useMemo(
    () =>
      northStarHistory.filter((north) => north.north_star_lifecycle_status === "active").length,
    [northStarHistory],
  );
  const totalNorthStarsCount = useMemo(
    () => rows.reduce((sum, row) => sum + row.north_stars_count, 0),
    [rows],
  );
  const creditHistoryRows = useMemo(
    () => buildCreditHistoryRows(operationsRows, operationsInitiatives, operationsCreditGrants),
    [operationsCreditGrants, operationsInitiatives, operationsRows],
  );

  const panelSummary = useMemo(() => {
    if (selectedPanelKey === "credit_history") {
      return [
        {
          label: "Clientes con paquetes",
          value: creditHistoryRows.filter((row) => row.billing === "paquetes").length,
        },
        {
          label: "Clientes recurrentes",
          value: creditHistoryRows.filter((row) => row.billing === "recurrencia").length,
        },
        {
          label: "Créditos disponibles",
          value: creditHistoryRows.reduce((sum, row) => sum + row.availableCredits, 0),
        },
      ];
    }

    return [
      { label: "Clientes", value: rows.length },
      { label: "Filtrados", value: filteredRows.length },
      {
        label: "Nortes",
        value: selectedPanelKey === "norths" ? activeNorthStarsCount : totalNorthStarsCount,
      },
    ];
  }, [activeNorthStarsCount, creditHistoryRows, filteredRows.length, rows.length, selectedPanelKey, totalNorthStarsCount]);

  const customerSuccessOptions = useMemo(
    () =>
      customerSuccessProfiles
        .map((profile) => [profile.id, profile.full_name || profile.email || "Sin nombre"] as [string, string])
        .sort(([, firstName], [, secondName]) => firstName.localeCompare(secondName, "es")),
    [customerSuccessProfiles],
  );

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

          {isCustomerSuccess ? null : (
          <div className="inline-flex rounded-[4px] border border-[#cbd6e2] bg-white p-1" aria-label="Paneles de informes">
            {[...panels]
              .sort((first, second) =>
                first.key === "operational" ? 1 : second.key === "operational" ? -1 : 0,
              )
              .map((panel) => (
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
          )}
        </div>

        <section className="border border-[#dfe3eb] bg-[#eef3f7]">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#dfe3eb] bg-white px-4 py-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#00a4bd]">
                Panel
              </p>
              <h2 className="mt-1 text-xl font-black text-[#213343]">{selectedPanel.title}</h2>
              {selectedPanel.description ? (
                <p className="mt-1 text-sm font-semibold text-[#516f90]">{selectedPanel.description}</p>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-4 text-right sm:grid-cols-3">
              {panelSummary.map((summary) => (
                <div key={summary.label}>
                  <p className="text-lg font-black text-[#213343]">{formatNumber(summary.value)}</p>
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#99acc2]">
                    {summary.label}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {selectedPanelKey === "clients" ? (
            <div className="grid gap-4 p-4 xl:grid-cols-2">
              {isCustomerSuccess ? (
                <div className="xl:col-span-2">
                  <CreditHistoryReport
                    rows={creditHistoryRows}
                    canEditObservations={canEditObservations}
                    goalProgress={monthlyGoalProgress}
                    progressFirst
                  />
                </div>
              ) : (
              <article className="overflow-hidden rounded-[6px] border border-[#dfe3eb] bg-white shadow-sm xl:col-span-2">
              <div className="border-b border-[#dfe3eb] p-4">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-black text-[#213343]">Clientes</h3>
                    <p className="mt-1 text-xs font-semibold text-[#516f90]">
                      Estado operativo, avance, créditos y nortes por cliente.
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
                label="Semáforo"
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
                label="Créditos"
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
                label="Facturación"
                value={filters.billing}
                onChange={(value) => setFilter("billing", value as FilterState["billing"])}
                options={[
                  ["all", "Toda facturación"],
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
                  ["days_without_progress", "Días sin avanzar"],
                  ["approved_work_remaining", "Casos validados"],
                  ["credits_remaining", "Créditos restantes"],
                  ["north_stars_count", "Cantidad de nortes"],
                  ["north_stars_completed", "Norte definido"],
                  ["health_color", "Semáforo"],
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
            <table className="w-full min-w-[1240px] border-collapse text-left">
              <thead className="bg-[#f8fbfd]">
                <tr className="border-b border-[#dfe3eb]">
                  {[
                    "Cliente",
                    "Fecha de inicio",
                    "Customer Success",
                    "Etapa",
                    "Días sin avanzar",
                    "Casos validados",
                    "Créditos restantes",
                    "Cantidad de nortes",
                    "Norte definido",
                    "Facturación",
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
              )}

              <KickoffWindowReport
                rows={clientReportRows}
                title="Dentro de 14 dias"
                description="Clientes con Kickoff completado hace menos de 14 dias y primer caso de uso pendiente."
                emptyTitle="Sin clientes dentro de esta ventana"
                emptyDescription="No hay clientes con Kickoff completado hace menos de 14 dias y primer caso pendiente."
                rowFilter={(row) =>
                  row.days_since_kickoff_completed !== null &&
                  row.days_since_kickoff_completed < 14 &&
                  row.first_use_case_completed_at === null
                }
                barTone="bg-[#00a4bd]"
                getSecondaryLabel={(days) => `${formatNumber(Math.max(14 - days, 0))} restantes`}
              />

              <KickoffWindowReport
                rows={clientReportRows}
                title="Fuera de 14 dias"
                description="Clientes con Kickoff completado hace mas de 14 dias y primer caso de uso pendiente."
                emptyTitle="Sin clientes fuera de esta ventana"
                emptyDescription="No hay clientes con Kickoff completado hace mas de 14 dias y primer caso pendiente."
                rowFilter={(row) =>
                  row.days_since_kickoff_completed !== null &&
                  row.days_since_kickoff_completed > 14 &&
                  row.first_use_case_completed_at === null
                }
                barTone="bg-[#f97316]"
                getSecondaryLabel={(days) => `${formatNumber(Math.max(days - 14, 0))} dias fuera`}
              />

              <FirstCaseCompletionReport
                rows={clientReportRows}
                title="Logrados en 14 dias"
                description="Clientes que cumplieron su primer caso de uso en menos de 14 dias desde Kickoff completado."
                emptyTitle="Sin clientes logrados en esta ventana"
                emptyDescription="No hay clientes con primer caso completado en menos de 14 dias desde Kickoff."
                rowFilter={(row) => row.days_to_first_use_case !== null && row.days_to_first_use_case < 14}
                barTone="bg-[#22c55e]"
              />

              <FirstCaseCompletionReport
                rows={clientReportRows}
                title="Incumplidos en 14 dias"
                description="Clientes que cumplieron su primer caso de uso en mas de 14 dias desde Kickoff completado."
                emptyTitle="Sin clientes incumplidos en esta ventana"
                emptyDescription="No hay clientes con primer caso completado en mas de 14 dias desde Kickoff."
                rowFilter={(row) => row.days_to_first_use_case !== null && row.days_to_first_use_case > 14}
                barTone="bg-[#ef4444]"
              />

              <ClientMetricBarsReport
                rows={clientReportRows}
                title="Clientes estancados"
                description="Clientes activos con casos de uso que llevan mas de 7 dias en la misma etapa."
                emptyTitle="Sin clientes estancados"
                emptyDescription="No hay clientes activos con casos de uso por encima de 7 dias en la misma etapa."
                rowFilter={(row) => row.stagnant_stage_days !== null && row.stagnant_stage_days > 7}
                getValue={(row) => row.stagnant_stage_days ?? 0}
                getMeta={(row) => `${formatNumber(row.stagnant_stage_days ?? 0)} dias en etapa actual`}
                valueLabel="Días"
                barTone="bg-[#8b5cf6]"
                sortDirection="desc"
              />

              <ClientMetricBarsReport
                rows={clientReportRows}
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
                rows={clientReportRows}
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
          ) : selectedPanelKey === "credit_history" ? (
            <div className="p-4">
              <CreditHistoryReport
                rows={creditHistoryRows}
                canEditObservations={canEditObservations}
                goalProgress={monthlyGoalProgress}
              />
            </div>
          ) : selectedPanelKey === "customer_success" ? (
            <CustomerSuccessDashboard
              rows={rows}
              initiatives={initiatives}
              customerSuccessConfigs={customerSuccessConfigs}
              customerSuccessCreditGrants={customerSuccessCreditGrants}
              customerSuccessOptions={customerSuccessOptions}
            />
          ) : selectedPanelKey === "operational" ? (
            <OperationalDashboard
              rows={rows}
              initiatives={initiatives}
              tasks={operationalTasks}
              customerSuccessOptions={customerSuccessOptions}
              transitionClients={operationalTransitionClients}
            />
          ) : (
            <>
              <NorthsDashboard rows={rows} initiatives={initiatives} northStarHistory={northStarHistory} initialAudits={northStarAudits as unknown as NorthAudit[]} customerSuccessOptions={customerSuccessOptions} canAudit={canAuditNorths} />
              <NorthFulfillmentReport
                rows={rows}
                initiatives={initiatives}
                tasks={operationalTasks}
                northStarHistory={northStarHistory}
              />
            </>
          )}
        </section>
      </div>
    </div>
  );
}

type CreditHistorySortKey =
  | "totalContractedCredits"
  | "flowCredits"
  | "availableCredits"
  | "flowWithContinuityCredits"
  | "evaluationCredits"
  | "committedCredits"
  | "completedCredits";

function creditHistorySortValue(row: CreditHistoryReportRow, key: CreditHistorySortKey) {
  return row[key];
}

// Semáforo del ciclo (vista client_cycle_milestones_report): cada una de Disponibles,
// En Evaluación y Comprometido se pinta con su propio color en Operaciones.
const CYCLE_COLUMN_COLOR_CLASSES: Record<CycleColumnColor, string> = {
  verde: "bg-emerald-50 text-emerald-700",
  naranja: "bg-orange-50 text-orange-700",
  rojo: "bg-rose-50 text-rose-700",
  gris: "bg-slate-100 text-slate-500",
};
const WINDOW_SOURCE_LABELS: Record<CreditHistoryReportRow["windowSource"], string> = {
  package: "desde la compra del último paquete",
  cycle: "ciclo vigente",
  pending_cycle: "desde un ciclo anterior con créditos pendientes",
  fallback: "últimos 30 días, sin paquete registrado",
};
const CYCLE_COLUMNS: Array<{
  key: keyof CycleColumnColors;
  creditsKey: "availableCredits" | "evaluationCredits" | "committedCredits";
  rule: string;
}> = [
  { key: "evaluation", creditsKey: "evaluationCredits", rule: "desde el día 25: ≥ 50% verde, ≥ 40% naranja, resto rojo" },
  { key: "available", creditsKey: "availableCredits", rule: "desde el día 15: < 10% verde, < 20% naranja, resto rojo" },
  { key: "committed", creditsKey: "committedCredits", rule: "desde el día 20: < 20% verde, < 30% naranja, resto rojo" },
];

// CS y Cuenta quedan fijas al hacer scroll horizontal; Cuenta se ancla justo después del ancho de CS.
const CREDIT_HISTORY_CS_WIDTH = "w-[160px] min-w-[160px] max-w-[160px]";
const CREDIT_HISTORY_CLIENT_LEFT = "left-[160px]";
const CREDIT_HISTORY_CLIENT_WIDTH = "min-w-[200px]";
const CREDIT_HISTORY_FROZEN_EDGE = "shadow-[inset_-1px_0_0_#cbd6e2,4px_0_6px_-4px_rgba(33,51,67,0.18)]";

const CREDIT_HISTORY_COLUMNS: Array<{ key: string; label: string; sortKey?: CreditHistorySortKey }> = [
  { key: "cs", label: "CS" },
  { key: "client", label: "Cuenta" },
  { key: "billing", label: "Tipo de servicio" },
  { key: "cycleStart", label: "Fecha de inicio del ciclo" },
  { key: "cycleEnd", label: "Fecha de finalización del ciclo" },
  { key: "activeService", label: "Continuidad" },
  { key: "contracted", label: "Créditos contratados", sortKey: "totalContractedCredits" },
  { key: "flow", label: "Créditos de caudal", sortKey: "flowCredits" },
  {
    key: "flowWithContinuity",
    label: "Créditos de caudal con recargo",
    sortKey: "flowWithContinuityCredits",
  },
  { key: "evaluation", label: "Créditos En Evaluación", sortKey: "evaluationCredits" },
  { key: "available", label: "Créditos disponibles", sortKey: "availableCredits" },
  { key: "committed", label: "Créditos comprometido", sortKey: "committedCredits" },
  { key: "completed", label: "Créditos completados", sortKey: "completedCredits" },
];

const OBSERVATIONS_POPOVER_WIDTH = 340;
const OBSERVATIONS_MAX_LENGTH = 5000;

// Indicador discreto junto al nombre de la cuenta; al hacer clic muestra las
// observaciones internas en una tarjeta flotante. Usa posición fija para no
// quedar recortada por el scroll de la tabla. Con canEdit (superadmin) se
// pueden editar desde la misma tarjeta.
function ClientObservationsPopover({
  clientId,
  clientName,
  observations,
  canEdit,
  onSaved,
}: {
  clientId: string;
  clientName: string;
  observations: string;
  canEdit: boolean;
  onSaved: (clientId: string, observations: string) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; placeAbove: boolean } | null>(
    null,
  );
  const [draft, setDraft] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEditing = draft !== null;
  const hasObservations = observations.trim().length > 0;

  useEffect(() => {
    if (!position) return;

    const close = () => {
      setPosition(null);
      setDraft(null);
      setError(null);
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      // Mientras se edita no se descarta el borrador por un clic accidental fuera.
      if (isEditing) return;
      close();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSaving) close();
    };
    const handleScroll = (event: Event) => {
      if (isEditing) return;
      if (panelRef.current?.contains(event.target as Node)) return;
      close();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", close);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [isEditing, isSaving, position]);

  function closePanel() {
    setPosition(null);
    setDraft(null);
    setError(null);
  }

  function toggle() {
    if (position) {
      if (!isSaving) closePanel();
      return;
    }

    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const gutter = 16;
    const left = Math.min(
      Math.max(gutter, rect.left - 12),
      window.innerWidth - OBSERVATIONS_POPOVER_WIDTH - gutter,
    );
    const placeAbove = window.innerHeight - rect.bottom < 320 && rect.top > 320;

    setPosition({
      top: placeAbove ? rect.top - 8 : rect.bottom + 8,
      left,
      placeAbove,
    });
    // Sin nota todavía, el superadmin entra directo a escribirla.
    if (canEdit && !hasObservations) setDraft("");
  }

  async function save() {
    if (draft === null || isSaving) return;

    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/cs/clients/${clientId}/observations`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ observations: draft }),
      });
      const payload = (await response.json()) as { observations?: string; message?: string };

      if (!response.ok) {
        throw new Error(payload.message || "No pudimos guardar las observaciones.");
      }

      onSaved(clientId, payload.observations ?? "");
      setDraft(null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No pudimos guardar las observaciones.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-expanded={Boolean(position)}
        aria-label={
          hasObservations ? `Ver observaciones de ${clientName}` : `Agregar observaciones a ${clientName}`
        }
        title={hasObservations ? "Ver observaciones" : "Agregar observaciones"}
        className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition ${
          position
            ? "border-[#ffbca6] bg-[#fff3ee] text-[#ff7a59]"
            : hasObservations
              ? "border-transparent text-[#9cb1c6] hover:border-[#ffd6c7] hover:bg-[#fff7f3] hover:text-[#ff7a59]"
              : "border-transparent text-[#cbd6e2] opacity-0 hover:border-[#ffd6c7] hover:bg-[#fff7f3] hover:text-[#ff7a59] focus-visible:opacity-100 group-hover/client:opacity-100"
        }`}
      >
        {hasObservations ? (
          <MessageSquareText className="h-3.5 w-3.5" />
        ) : (
          <MessageSquarePlus className="h-3.5 w-3.5" />
        )}
      </button>
      {/* Portal: las celdas fijas (sticky) de la tabla crean su propio apilamiento y lo taparían. */}
      {position ? createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label={`Observaciones de ${clientName}`}
          style={{
            top: position.top,
            left: position.left,
            width: OBSERVATIONS_POPOVER_WIDTH,
            transform: position.placeAbove ? "translateY(-100%)" : undefined,
          }}
          className="fixed z-50 overflow-hidden rounded-[8px] border border-[#dfe3eb] bg-white text-left shadow-[0_12px_32px_rgba(33,51,67,0.16)]"
        >
          <div className="flex items-center justify-between gap-3 border-b border-[#edf1f5] bg-[#fffaf5] px-4 py-2.5">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#ff7a59]">
                Observaciones
              </p>
              <p className="truncate text-xs font-bold text-[#213343]">{clientName}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {canEdit && !isEditing ? (
                <button
                  type="button"
                  onClick={() => setDraft(observations)}
                  aria-label="Editar observaciones"
                  title="Editar"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[#9cb1c6] transition hover:bg-white hover:text-[#ff7a59]"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              ) : null}
              <button
                type="button"
                onClick={closePanel}
                disabled={isSaving}
                aria-label="Cerrar observaciones"
                className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[#9cb1c6] transition hover:bg-white hover:text-[#516f90] disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          {isEditing ? (
            <div className="space-y-2 px-4 py-3">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={OBSERVATIONS_MAX_LENGTH}
                rows={5}
                autoFocus
                placeholder="Deja observaciones sobre el cliente para el equipo."
                className="w-full resize-y rounded-[6px] border border-[#cbd6e2] bg-white px-3 py-2 text-[13px] font-medium leading-6 text-[#33475b] outline-none transition placeholder:text-[#9cb1c6] focus:border-[#ff7a59] focus:ring-2 focus:ring-[#ff7a59]/15"
              />
              {error ? <p className="text-xs font-semibold text-[#d9534f]">{error}</p> : null}
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold text-[#9cb1c6]">
                  {draft.length}/{OBSERVATIONS_MAX_LENGTH}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => (hasObservations ? setDraft(null) : closePanel())}
                    disabled={isSaving}
                    className="h-8 rounded-[4px] border border-[#cbd6e2] bg-white px-3 text-[11px] font-bold text-[#516f90] transition hover:border-[#9cb1c6] disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => void save()}
                    disabled={isSaving}
                    className="h-8 rounded-[4px] bg-[#00bda5] px-3 text-[11px] font-bold text-white transition hover:bg-[#00a894] disabled:opacity-60"
                  >
                    {isSaving ? "Guardando..." : "Guardar"}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <p className="max-h-64 overflow-y-auto whitespace-pre-line break-words px-4 py-3 text-[13px] font-medium leading-6 text-[#33475b]">
              {hasObservations ? (
                observations
              ) : (
                <span className="text-[#9cb1c6]">Sin observaciones sobre este cliente.</span>
              )}
            </p>
          )}
        </div>,
        document.body,
      ) : null}
    </>
  );
}
const BREAKDOWN_POPOVER_WIDTH = 380;

const BREAKDOWN_COPY: Record<CreditBreakdownKey, { title: string; rule: string; empty: string }> = {
  evaluation: {
    title: "Créditos en evaluación",
    rule: "Todos los casos que hoy están en evaluación, sin importar la fecha.",
    empty: "No hay casos en evaluación.",
  },
  available: {
    title: "Créditos disponibles",
    rule: "Saldo vigente de los créditos otorgados dentro del periodo.",
    empty: "No hay créditos vigentes.",
  },
  committed: {
    title: "Créditos comprometidos",
    rule: "Casos que pasaron a Planificado o En ejecución dentro del periodo.",
    empty: "No hay casos planificados ni en ejecución.",
  },
  completed: {
    title: "Créditos completados",
    rule: "Casos que pasaron a Completado dentro del periodo.",
    empty: "No hay casos completados en el periodo.",
  },
};

// Cifra de una columna de créditos que, al hacer clic, muestra los casos (o grants) que la
// componen con la fecha en que pasaron a su etapa, para justificar el número y el semáforo.
function CreditBreakdownPopover({
  row,
  breakdownKey,
  value,
  className,
  title,
}: {
  row: CreditHistoryReportRow;
  breakdownKey: CreditBreakdownKey;
  value: number;
  className: string;
  title?: string;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; placeAbove: boolean } | null>(
    null,
  );

  useEffect(() => {
    if (!position) return;

    const close = () => setPosition(null);
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const handleScroll = (event: Event) => {
      if (panelRef.current?.contains(event.target as Node)) return;
      close();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", close);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [position]);

  function toggle() {
    if (position) {
      setPosition(null);
      return;
    }

    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const gutter = 16;
    const left = Math.min(
      Math.max(gutter, rect.right - BREAKDOWN_POPOVER_WIDTH),
      window.innerWidth - BREAKDOWN_POPOVER_WIDTH - gutter,
    );
    const placeAbove = window.innerHeight - rect.bottom < 360 && rect.top > 360;

    setPosition({ top: placeAbove ? rect.top - 8 : rect.bottom + 8, left, placeAbove });
  }

  const copy = BREAKDOWN_COPY[breakdownKey];
  const items = row.breakdown[breakdownKey];
  const included = items.filter((item) => item.included);
  const excluded = items.filter((item) => !item.included);
  const includedTotal = included.reduce((sum, item) => sum + item.credits, 0);
  const isWindowed = breakdownKey !== "evaluation";
  const periodLabel = row.windowEnd
    ? `${formatDate(row.windowStart)} – ${formatDate(row.windowEnd)}`
    : `${formatDate(row.windowStart)} – hoy`;
  // Días desde que terminó el ciclo usado como periodo (sin un ciclo nuevo pagado se sigue usando).
  const todayIsoDate = new Date().toISOString().slice(0, 10);
  const daysSinceCycleEnded =
    isWindowed && row.windowEnd && row.windowEnd < todayIsoDate
      ? Math.round(
          (new Date(`${todayIsoDate}T00:00:00Z`).getTime() - new Date(`${row.windowEnd}T00:00:00Z`).getTime()) /
            86_400_000,
        )
      : null;
  // Disponibles nunca supera el saldo real del cliente (ajustes, pérdidas, etc.).
  const isCappedByBalance = breakdownKey === "available" && value < includedTotal;

  function renderItem(item: CreditBreakdownItem) {
    return (
      <li
        key={item.key}
        className={`flex items-start justify-between gap-3 px-4 py-2.5 ${item.included ? "" : "opacity-60"}`}
      >
        <div className="min-w-0">
          <p className={`text-[13px] font-bold text-[#213343] ${item.included ? "" : "line-through decoration-[#99acc2]"}`}>
            {item.title}
          </p>
          <p className="mt-0.5 text-[11px] font-semibold text-[#516f90]">
            {item.dateLabel} {item.date ? formatDate(item.date.slice(0, 10)) : "sin fecha"}
            {item.expiresAt ? ` · vence ${formatDate(item.expiresAt.slice(0, 10))}` : ""}
          </p>
          <span className="mt-1 inline-flex rounded-full bg-[#f5f8fa] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[#516f90]">
            {item.stage}
          </span>
        </div>
        <span className="shrink-0 text-[13px] font-black text-[#213343]">{formatNumber(item.credits)} CR</span>
      </li>
    );
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-expanded={Boolean(position)}
        aria-label={`Ver detalle de ${copy.title.toLowerCase()} de ${row.clientName}`}
        title={title ?? "Ver detalle"}
        className={`${className} cursor-pointer underline decoration-dotted decoration-1 underline-offset-4 transition hover:ring-2 hover:ring-[#00a4bd]/25`}
      >
        {formatNumber(value)} CR
      </button>
      {position ? createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label={`${copy.title} de ${row.clientName}`}
          style={{
            top: position.top,
            left: position.left,
            width: BREAKDOWN_POPOVER_WIDTH,
            transform: position.placeAbove ? "translateY(-100%)" : undefined,
          }}
          className="fixed z-50 overflow-hidden rounded-[8px] border border-[#dfe3eb] bg-white text-left normal-case tracking-normal shadow-[0_12px_32px_rgba(33,51,67,0.16)]"
        >
          <div className="flex items-start justify-between gap-3 border-b border-[#edf1f5] bg-[#f5f8fa] px-4 py-2.5">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#00a4bd]">{copy.title}</p>
              <p className="truncate text-xs font-bold text-[#213343]">{row.clientName}</p>
              <p className="mt-1 text-[11px] font-semibold leading-snug text-[#516f90]">
                {copy.rule}
                {isWindowed ? (
                  <>
                    {" "}
                    Periodo: <span className="font-bold text-[#33475b]">{periodLabel}</span> (
                    {WINDOW_SOURCE_LABELS[row.windowSource]}).
                  </>
                ) : null}
              </p>
              {daysSinceCycleEnded !== null ? (
                <p className="mt-1.5 inline-flex items-center gap-1 rounded-[4px] bg-amber-50 px-2 py-1 text-[11px] font-bold leading-snug text-amber-700">
                  <CircleAlert className="h-3.5 w-3.5 shrink-0" />
                  El ciclo terminó hace {daysSinceCycleEnded} {daysSinceCycleEnded === 1 ? "día" : "días"} y no
                  hay uno nuevo pagado.
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setPosition(null)}
              aria-label="Cerrar detalle"
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[#9cb1c6] transition hover:bg-white hover:text-[#516f90]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {included.length ? (
              <ul className="divide-y divide-[#edf1f5]">{included.map(renderItem)}</ul>
            ) : (
              <p className="px-4 py-3 text-[13px] font-medium text-[#9cb1c6]">
                {isWindowed && excluded.length ? "Nada dentro del periodo." : copy.empty}
              </p>
            )}
            {excluded.length ? (
              <>
                <p className="border-t border-[#edf1f5] bg-[#fafbfc] px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[#99acc2]">
                  Fuera del periodo · no suman
                </p>
                <ul className="divide-y divide-[#edf1f5]">{excluded.map(renderItem)}</ul>
              </>
            ) : null}
          </div>
          <div className="border-t border-[#edf1f5] bg-[#f5f8fa] px-4 py-2.5">
            <div className="flex items-center justify-between text-xs font-black text-[#213343]">
              <span>Total</span>
              <span>{formatNumber(value)} CR</span>
            </div>
            {isCappedByBalance ? (
              <p className="mt-1 text-[11px] font-semibold leading-snug text-[#516f90]">
                Lo otorgado en el periodo suma {formatNumber(includedTotal)} CR, pero se limita al saldo real
                del cliente ({formatNumber(row.currentBalance)} CR).
              </p>
            ) : null}
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}

function CreditHistoryReport({
  rows,
  canEditObservations,
  goalProgress,
  progressFirst = false,
}: {
  rows: CreditHistoryReportRow[];
  canEditObservations: boolean;
  goalProgress: MonthlyGoalProgress[];
  // Vista de un CS: el progreso contra la meta va al inicio, antes de la tabla.
  progressFirst?: boolean;
}) {
  const [searchTerm, setSearchTerm] = useState("");
  // Notas editadas en esta sesión; se superponen a las que llegaron del servidor.
  const [observationOverrides, setObservationOverrides] = useState<Map<string, string>>(
    () => new Map(),
  );

  function handleObservationsSaved(clientId: string, observations: string) {
    setObservationOverrides((current) => new Map(current).set(clientId, observations));
  }
  const [csFilter, setCsFilter] = useState("all");
  const [billingFilter, setBillingFilter] = useState<"all" | CreditHistoryReportRow["billing"]>("all");
  const [sort, setSort] = useState<{ key: CreditHistorySortKey; direction: "asc" | "desc" } | null>(null);

  const csFilterOptions = useMemo(() => {
    const byKey = new Map<string, string>();
    rows.forEach((row) => {
      const key = row.customerSuccessId ?? "__unassigned__";
      if (!byKey.has(key)) byKey.set(key, row.customerSuccessName || "Sin asignar");
    });
    return [...byKey.entries()].sort(([, first], [, second]) => first.localeCompare(second, "es"));
  }, [rows]);

  function toggleSort(key: CreditHistorySortKey) {
    setSort((current) => {
      if (!current || current.key !== key) return { key, direction: "desc" };
      return { key, direction: current.direction === "desc" ? "asc" : "desc" };
    });
  }

  const groups = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const byCs = new Map<string, { csId: string | null; csName: string; clients: CreditHistoryReportRow[] }>();

    rows.forEach((row) => {
      if (normalizedSearch && !row.clientName.toLowerCase().includes(normalizedSearch)) return;
      if (billingFilter !== "all" && row.billing !== billingFilter) return;

      const key = row.customerSuccessId ?? "__unassigned__";
      if (csFilter !== "all" && csFilter !== key) return;

      const group = byCs.get(key) ?? {
        csId: row.customerSuccessId,
        csName: row.customerSuccessName || "Sin asignar",
        clients: [] as CreditHistoryReportRow[],
      };
      group.clients.push(row);
      byCs.set(key, group);
    });

    return [...byCs.values()]
      .map((group) => {
        const clients = [...group.clients].sort((first, second) => {
          if (sort) {
            const diff =
              creditHistorySortValue(first, sort.key) - creditHistorySortValue(second, sort.key);
            if (diff !== 0) return sort.direction === "asc" ? diff : -diff;
          }
          return first.clientName.localeCompare(second.clientName, "es");
        });
        const totals = clients.reduce(
          (accumulator, client) => ({
            flowCredits: accumulator.flowCredits + client.flowCredits,
            flowWithContinuityCredits:
              accumulator.flowWithContinuityCredits + client.flowWithContinuityCredits,
            availableCredits: accumulator.availableCredits + client.availableCredits,
            evaluationCredits: accumulator.evaluationCredits + client.evaluationCredits,
            committedCredits: accumulator.committedCredits + client.committedCredits,
            completedCredits: accumulator.completedCredits + client.completedCredits,
          }),
          {
            flowCredits: 0,
            flowWithContinuityCredits: 0,
            availableCredits: 0,
            evaluationCredits: 0,
            committedCredits: 0,
            completedCredits: 0,
          },
        );

        return {
          ...group,
          clients,
          totals,
        };
      })
      .sort((first, second) => first.csName.localeCompare(second.csName, "es"));
  }, [rows, searchTerm, billingFilter, csFilter, sort]);

  const totalClients = groups.reduce((sum, group) => sum + group.clients.length, 0);

  return (
    <div className="space-y-8">
    {progressFirst ? <MonthlyGoalReport progress={goalProgress} isCustomerSuccess /> : null}
    <article className="overflow-hidden rounded-[6px] border border-[#dfe3eb] bg-white shadow-sm">
      <div className="flex flex-col gap-4 border-b border-[#dfe3eb] p-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-black text-[#213343]">Operaciones por cliente</h3>
          </div>
          <p className="mt-1 text-xs font-semibold text-[#516f90]">
            Agrupado por Customer Success, en orden alfabético.
          </p>
        </div>

        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-end lg:w-auto">
          <label className="w-full space-y-1.5 sm:w-64">
            <span className="block whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.16em] text-[#99acc2]">
              Customer Success
            </span>
            <select
              value={csFilter}
              onChange={(event) => setCsFilter(event.target.value)}
              className="block h-10 w-full rounded-[4px] border border-[#cbd6e2] bg-white px-3 text-sm font-bold text-[#33475b] outline-none focus:border-[#00a4bd]"
            >
              <option value="all">Todos</option>
              {csFilterOptions.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>

          <label className="w-full space-y-1.5 sm:w-56">
            <span className="block whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.16em] text-[#99acc2]">
              Tipo de servicio
            </span>
            <select
              value={billingFilter}
              onChange={(event) =>
                setBillingFilter(event.target.value as "all" | CreditHistoryReportRow["billing"])
              }
              className="block h-10 w-full rounded-[4px] border border-[#cbd6e2] bg-white px-3 text-sm font-bold text-[#33475b] outline-none focus:border-[#00a4bd]"
            >
              <option value="all">Todos</option>
              <option value="paquetes">Paquete</option>
              <option value="recurrencia">Recurrente</option>
            </select>
          </label>

          <label className="w-full space-y-1.5 lg:max-w-sm">
            <span className="block whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.16em] text-[#99acc2]">
              Buscar cliente
            </span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#516f90]" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="h-10 w-full rounded-[4px] border border-[#cbd6e2] bg-white pl-9 pr-3 text-sm font-semibold text-[#33475b] outline-none transition focus:border-[#00a4bd] focus:ring-2 focus:ring-[#00a4bd]/15"
                placeholder="Nombre del cliente"
              />
            </div>
          </label>
        </div>
      </div>

      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full min-w-[1880px] border-collapse text-left">
          <thead>
            <tr className="border-b-2 border-[#33475b]">
              {CREDIT_HISTORY_COLUMNS.map((column) => (
                <th
                  key={column.key}
                  className={`sticky top-0 border-b-2 border-[#33475b] bg-[#eef3f8] px-4 py-3 text-[10px] font-black uppercase tracking-[0.14em] text-[#213343] ${
                    column.key === "cs"
                      ? `left-0 z-30 ${CREDIT_HISTORY_CS_WIDTH} shadow-[0_1px_0_rgba(33,51,67,0.08)]`
                      : column.key === "client"
                        ? `${CREDIT_HISTORY_CLIENT_LEFT} z-30 ${CREDIT_HISTORY_CLIENT_WIDTH} ${CREDIT_HISTORY_FROZEN_EDGE}`
                        : "z-10 shadow-[0_1px_0_rgba(33,51,67,0.08)]"
                  }`}
                >
                  {column.sortKey ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(column.sortKey as CreditHistorySortKey)}
                      className="inline-flex items-center gap-1 font-black uppercase hover:text-[#00a4bd]"
                    >
                      {column.label}
                      {sort?.key === column.sortKey ? (
                        sort.direction === "asc" ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )
                      ) : (
                        <ArrowUpDown className="h-3 w-3 opacity-40" />
                      )}
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((group, groupIndex) => {
              const isEvenGroup = groupIndex % 2 === 0;
              const rowBg = isEvenGroup ? "bg-white" : "bg-[#f4f7fb]";
              const rowHoverBg = isEvenGroup ? "hover:bg-[#eef6fa]" : "hover:bg-[#e8f1f7]";
              const csCellBg = isEvenGroup ? "bg-[#eef3f8]" : "bg-[#e2ebf5]";
              return (
              <Fragment key={group.csId ?? "__unassigned__"}>
                {group.clients.map((row, rowIndex) => (
                  <tr
                    key={row.clientId}
                    className={`group/row border-b border-[#edf1f5] last:border-b-0 ${rowBg} ${rowHoverBg} ${
                      rowIndex === 0 && groupIndex > 0 ? "border-t-4 border-t-[#33475b]" : ""
                    }`}
                  >
                    {rowIndex === 0 ? (
                      <td
                        rowSpan={group.clients.length}
                        className={`sticky left-0 z-[5] ${CREDIT_HISTORY_CS_WIDTH} ${csCellBg} px-4 py-4 align-top shadow-[inset_-2px_0_0_rgba(51,71,91,0.4)]`}
                      >
                        <p className="text-sm font-bold text-[#213343]">{group.csName}</p>
                      </td>
                    ) : null}
                    <td
                      className={`sticky ${CREDIT_HISTORY_CLIENT_LEFT} z-[5] ${CREDIT_HISTORY_CLIENT_WIDTH} ${rowBg} ${
                        isEvenGroup ? "group-hover/row:bg-[#eef6fa]" : "group-hover/row:bg-[#e8f1f7]"
                      } ${CREDIT_HISTORY_FROZEN_EDGE} px-4 py-4`}
                    >
                      <div className="group/client flex items-center gap-2">
                        <a
                          href={`/clients/${row.clientId}`}
                          className="text-sm font-black text-[#213343] hover:text-[#00a4bd]"
                        >
                          {row.clientName}
                        </a>
                        {(() => {
                          const observations =
                            observationOverrides.get(row.clientId) ?? row.observations ?? "";
                          return observations.trim() || canEditObservations ? (
                            <ClientObservationsPopover
                              clientId={row.clientId}
                              clientName={row.clientName}
                              observations={observations}
                              canEdit={canEditObservations}
                              onSaved={handleObservationsSaved}
                            />
                          ) : null;
                        })()}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${
                          row.billing === "paquetes" ? "bg-violet-50 text-violet-700" : "bg-sky-50 text-sky-700"
                        }`}
                      >
                        {row.billing === "paquetes" ? "Paquete" : "Recurrente"}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-sm font-semibold text-[#33475b]">
                      {formatDate(row.cycleStartAt)}
                    </td>
                    <td className="px-4 py-4 text-sm font-semibold text-[#33475b]">
                      {row.cycleEndAt ? formatDate(row.cycleEndAt) : "-"}
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${
                          row.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {row.isActive ? "Sí" : "No"}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-sm font-black text-[#213343]">
                      {formatNumber(row.totalContractedCredits)} CR
                    </td>
                    <td className="px-4 py-4 text-sm font-bold text-[#33475b]">
                      {formatNumber(row.flowCredits)} CR
                    </td>
                    <td className="px-4 py-4 text-sm font-bold text-[#33475b]">
                      {formatNumber(row.flowWithContinuityCredits)} CR
                    </td>
                    {CYCLE_COLUMNS.map((column) => {
                      const color = row.cycleColors?.[column.key];
                      return (
                        <td key={column.key} className="px-4 py-4">
                          <CreditBreakdownPopover
                            row={row}
                            breakdownKey={column.key}
                            value={row[column.creditsKey]}
                            className={`inline-flex rounded-full px-2.5 py-1 text-sm font-black ${
                              color ? CYCLE_COLUMN_COLOR_CLASSES[color] : "text-[#33475b]"
                            }`}
                            title={color ? `Semáforo ${column.rule}. Clic para ver el detalle.` : undefined}
                          />
                        </td>
                      );
                    })}
                    <td className="px-4 py-4">
                      <CreditBreakdownPopover
                        row={row}
                        breakdownKey="completed"
                        value={row.completedCredits}
                        className="inline-flex rounded-full px-2.5 py-1 text-sm font-bold text-[#33475b]"
                      />
                    </td>
                  </tr>
                ))}
                <tr className={`border-b-2 border-[#33475b]/30 ${csCellBg} font-black text-[#213343]`}>
                  <td
                    colSpan={2}
                    className={`sticky left-0 z-[5] ${csCellBg} ${CREDIT_HISTORY_FROZEN_EDGE} px-4 py-3 text-sm uppercase tracking-[0.06em]`}
                  >
                    Total {group.csName}
                  </td>
                  <td className="px-4 py-3 text-sm">-</td>
                  <td className="px-4 py-3 text-sm">-</td>
                  <td className="px-4 py-3 text-sm">-</td>
                  <td className="px-4 py-3 text-sm">-</td>
                  <td className="px-4 py-3 text-sm">-</td>
                  <td className="px-4 py-3 text-sm">{formatNumber(group.totals.flowCredits)} CR</td>
                  <td className="px-4 py-3 text-sm">
                    {formatNumber(group.totals.flowWithContinuityCredits)} CR
                  </td>
                  <td className="px-4 py-3 text-sm">{formatNumber(group.totals.evaluationCredits)} CR</td>
                  <td className="px-4 py-3 text-sm">{formatNumber(group.totals.availableCredits)} CR</td>
                  <td className="px-4 py-3 text-sm">{formatNumber(group.totals.committedCredits)} CR</td>
                  <td className="px-4 py-3 text-sm">{formatNumber(group.totals.completedCredits)} CR</td>
                </tr>
              </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalClients === 0 ? (
        <div className="flex min-h-48 flex-col items-center justify-center gap-3 px-4 py-12 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-[4px] border border-[#dfe3eb] bg-white text-[#516f90]">
            <Table2 className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-black text-[#213343]">Sin clientes</p>
            <p className="mt-1 text-sm font-medium text-[#516f90]">
              No hay clientes que coincidan con la búsqueda.
            </p>
          </div>
        </div>
      ) : null}
    </article>

    {progressFirst ? null : <MonthlyGoalReport progress={goalProgress} isCustomerSuccess={false} />}
    </div>
  );
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("");
}

function GoalProgressBar({
  label,
  completedCredits,
  goalCredits,
  percentage,
  emphasis = false,
  showCredits = false,
  isOwn = false,
}: {
  label: string;
  // Null cuando no se envían (barras de otros CS en la vista de un CS).
  completedCredits: number | null;
  goalCredits: number | null;
  // Avance sobre la meta; null sin meta.
  percentage: number | null;
  emphasis?: boolean;
  // Muestra "completados / meta CR" junto al nombre (solo en la vista del CS).
  showCredits?: boolean;
  // Barra del propio CS en su vista: se resalta.
  isOwn?: boolean;
}) {
  const barHeight = emphasis ? "h-10" : "h-8";
  const hasGoal = percentage !== null;
  const ratio = hasGoal ? percentage / 100 : 0;
  const pct = percentage ?? 0;
  const creditsVisible = showCredits && completedCredits !== null;
  const fillPct = Math.min(ratio, 1) * 100;
  // Con poco avance el porcentaje no cabe dentro del relleno; se muestra justo a su derecha.
  const labelInside = fillPct >= 12;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {emphasis ? null : (
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-black ${
                hasGoal ? "bg-[#213343] text-white" : "bg-[#edf3f7] text-[#99acc2]"
              }`}
            >
              {getInitials(label)}
            </span>
          )}
          <span
            className={`truncate font-black ${emphasis ? "text-lg" : "text-base"} ${
              hasGoal ? "text-[#213343]" : "text-[#99acc2]"
            }`}
          >
            {label}
          </span>
          {isOwn ? (
            <span className="shrink-0 rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-orange-600">
              Tú
            </span>
          ) : null}
        </div>
        <span
          className={`whitespace-nowrap text-sm font-bold ${hasGoal ? "text-[#516f90]" : "text-[#99acc2]"}`}
        >
          {hasGoal
            ? creditsVisible
              ? `${formatNumber(completedCredits)} / ${formatNumber(goalCredits ?? 0)} CR`
              : null
            : creditsVisible
              ? `${formatNumber(completedCredits)} CR · Sin meta`
              : "Sin meta"}
        </span>
      </div>
      <div className={`relative mt-2 overflow-hidden rounded-full bg-[#edf3f7] ${barHeight}`}>
        {hasGoal ? (
          <>
            <div
              className={`h-full rounded-full ${ratio >= 1 ? "bg-emerald-500" : "bg-orange-400"}`}
              style={{ width: `${fillPct}%` }}
            />
            <span
              className={`absolute inset-y-0 flex items-center font-black text-[#213343] ${emphasis ? "text-base" : "text-sm"}`}
              style={
                labelInside
                  ? { right: `calc(${100 - fillPct}% + 12px)` }
                  : { left: `calc(${fillPct}% + 8px)` }
              }
            >
              {pct}%
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}

function MonthlyGoalReport({
  progress,
  isCustomerSuccess,
}: {
  // Del mes más reciente (el actual) al más antiguo.
  progress: MonthlyGoalProgress[];
  isCustomerSuccess: boolean;
}) {
  const [selectedMonth, setSelectedMonth] = useState(progress[0]?.month ?? "");
  const selected = progress.find((entry) => entry.month === selectedMonth) ?? progress[0];

  if (!selected) return null;

  return (
    <article className="overflow-hidden rounded-[6px] border border-[#dfe3eb] border-t-4 border-t-orange-400 bg-white shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#dfe3eb] bg-[#fff8f3] p-5">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-500">Reporte de avance</p>
          <div className="mt-1 flex items-center gap-2">
            <h3 className="text-lg font-black text-[#213343]">Progreso vs. meta mensual</h3>
            <InfoTooltip>
              Cada barra suma los créditos de los casos de uso completados dentro del mes calendario en
              los clientes del CS y los compara con su meta del mes (definida en Catálogos › Metas CS).
              Todos los CS suma lo completado por todos sobre la suma de sus metas. Los casos cuentan
              para el CS asignado hoy al cliente. La barra se pone verde al alcanzar la meta.
            </InfoTooltip>
          </div>
          <p className="mt-1 text-xs font-semibold text-[#516f90]">
            {isCustomerSuccess
              ? "Tus créditos completados en el mes sobre tu meta, y el avance del resto del equipo."
              : "Créditos completados en el mes sobre la meta de cada CS."}
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs font-bold text-[#516f90]">
          Mes
          <select
            value={selected.month}
            onChange={(event) => setSelectedMonth(event.target.value)}
            className="h-9 rounded-[3px] border border-[#cbd6e2] bg-white px-3 text-sm font-bold capitalize text-[#213343]"
          >
            {progress.map((entry) => (
              <option key={entry.month} value={entry.month}>
                {formatMonthLabel(entry.month)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="space-y-6 p-5">
        {isCustomerSuccess ? null : (
          <GoalProgressBar
            label="Todos los CS"
            completedCredits={selected.overall.completedCredits}
            goalCredits={selected.overall.goalCredits}
            percentage={
              selected.overall.goalCredits > 0
                ? Math.round((selected.overall.completedCredits / selected.overall.goalCredits) * 100)
                : null
            }
            emphasis
          />
        )}
        <div className={`space-y-5 ${isCustomerSuccess ? "" : "border-t border-[#edf1f5] pt-6"}`}>
          {selected.customerSuccess.length ? (
            selected.customerSuccess.map((entry, index) => (
              <GoalProgressBar
                key={entry.csId}
                label={entry.csName}
                completedCredits={entry.completedCredits}
                goalCredits={entry.goalCredits}
                percentage={entry.percentage}
                showCredits={isCustomerSuccess}
                // En la vista del CS su propia barra llega primero.
                isOwn={isCustomerSuccess && index === 0}
              />
            ))
          ) : (
            <p className="text-sm font-semibold text-[#99acc2]">
              No hay metas ni casos completados en este mes.
            </p>
          )}
        </div>
      </div>
    </article>
  );
}

type CustomerSuccessDetail = "active" | "stagnant" | "weak" | "completed";

function NorthsDashboard({ rows, initiatives, northStarHistory, initialAudits, customerSuccessOptions, canAudit }: { rows: ClientHealthReportRow[]; initiatives: InitiativeReportRow[]; northStarHistory: NorthHistoryRow[]; initialAudits: NorthAudit[]; customerSuccessOptions: Array<[string, string]>; canAudit: boolean }) {
  const [csmId, setCsmId] = useState("all");
  const [audits, setAudits] = useState(() => new Map(initialAudits.map((audit) => [audit.north_star_history_id, audit])));
  const clientById = useMemo(() => new Map(rows.map((row) => [row.client_id, row])), [rows]);
  const scoped = useMemo(
    () =>
      northStarHistory.filter(
        (north) =>
          north.north_star_lifecycle_status === "active" &&
          (csmId === "all" || clientById.get(north.client_id)?.customer_success_id === csmId),
      ),
    [clientById, csmId, northStarHistory],
  );
  const qualityRows = scoped.map((north) => {
    const audit = audits.get(north.id);
    const value = audit
      ? [audit.is_from, audit.is_until, audit.is_timed, audit.is_crucial].filter(Boolean).length * 25
      : 0;

    return {
      id: north.id,
      clientName: clientById.get(north.client_id)?.client_name ?? "Cliente",
      value,
    };
  }).sort((first, second) => second.value - first.value || first.clientName.localeCompare(second.clientName, "es"));
  const maxDays = Math.max(...scoped.map((north) => getElapsedDays(north.created_at)), 1);
  const waiting = rows.filter((row) => {
    const history = northStarHistory.filter((north) => north.client_id === row.client_id);
    const latest = history.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
    return latest?.north_star_lifecycle_status === "fulfilled" && row.credits_remaining > 0 && !history.some((item) => item.north_star_lifecycle_status === "active");
  });
  async function save(id: string, patch: Partial<NorthAudit>) {
    if (!canAudit) return;
    const next = { north_star_history_id: id, is_from: false, is_until: false, is_timed: false, is_crucial: false, has_associated_use_cases: false, notes: "", ...(audits.get(id) ?? {}), ...patch };
    setAudits((current) => new Map(current).set(id, next));
    await fetch("/api/reports/north-audits", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ northStarHistoryId: id, isFrom: next.is_from, isUntil: next.is_until, isTimed: next.is_timed, isCrucial: next.is_crucial, hasAssociatedUseCases: next.has_associated_use_cases, notes: next.notes }) });
  }
  return <div className="space-y-4 p-4"><div className="flex justify-end"><select value={csmId} onChange={(event) => setCsmId(event.target.value)} className="h-10 rounded border border-[#cbd6e2] bg-white px-3 text-sm font-bold text-[#33475b]"><option value="all">Todo el equipo CS</option>{customerSuccessOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></div>{canAudit ? <article className="overflow-x-auto rounded-[6px] border border-[#dfe3eb] bg-white"><div className="border-b border-[#dfe3eb] p-4"><h3 className="font-black text-[#213343]">Auditoría de Nortes</h3></div><table className="w-full min-w-[1200px] text-left text-xs"><thead className="bg-[#f8fbfd]"><tr>{["Cliente", "Norte", "CS", "Días", "X", "Y", "T", "C", "Casos asociados", "Anotaciones"].map((heading) => <th key={heading} className="px-3 py-3 font-bold uppercase tracking-wide text-[#516f90]">{heading}</th>)}</tr></thead><tbody>{scoped.map((north) => { const row = clientById.get(north.client_id); const audit = audits.get(north.id) ?? { is_from: false, is_until: false, is_timed: false, is_crucial: false, has_associated_use_cases: false, notes: "" }; const fields: Array<keyof Pick<NorthAudit, "is_from" | "is_until" | "is_timed" | "is_crucial" | "has_associated_use_cases">> = ["is_from", "is_until", "is_timed", "is_crucial", "has_associated_use_cases"]; return <tr key={north.id} className="border-t border-[#edf1f5]"><td className="px-3 py-3 font-bold text-[#213343]">{row?.client_name}</td><td className="max-w-64 px-3 py-3 text-[#516f90]">{north.north_star_text}</td><td className="px-3 py-3">{row?.customer_success_name ?? "Sin asignar"}</td><td className="px-3 py-3 font-bold">{getElapsedDays(north.created_at)}</td>{fields.map((field) => <td key={field} className="px-3 py-3"><input type="checkbox" checked={audit[field]} onChange={(event) => void save(north.id, { [field]: event.target.checked })} /></td>)}<td className="px-3 py-3"><input defaultValue={audit.notes} onBlur={(event) => void save(north.id, { notes: event.target.value })} className="w-44 rounded border border-[#cbd6e2] px-2 py-1" /></td></tr>; })}</tbody></table></article> : null}<div className="grid gap-4 xl:grid-cols-2"><article className="rounded-[6px] border border-[#dfe3eb] bg-white p-4"><h3 className="font-black text-[#213343]">Calidad de Nortes</h3><p className="text-xs text-[#516f90]">Cada X, Y, T y C aporta 25%.</p><div className="mt-4 space-y-3">{qualityRows.map((row) => <div key={row.id}><div className="flex justify-between gap-3 text-xs font-bold text-[#516f90]"><span className="truncate">{row.clientName}</span><span>{row.value}%</span></div><div className="mt-1 h-3 bg-[#edf3f7]"><div className="h-full bg-[#00a4bd]" style={{ width: `${row.value}%` }} /></div></div>)}{!qualityRows.length ? <p className="py-4 text-sm text-[#516f90]">No hay Nortes activos para auditar.</p> : null}</div></article><article className="rounded-[6px] border border-[#dfe3eb] bg-white p-4"><h3 className="font-black text-[#213343]">Antigüedad</h3><div className="mt-4 space-y-3">{[...scoped].sort((a,b) => getElapsedDays(b.created_at) - getElapsedDays(a.created_at)).slice(0, 8).map((north) => <div key={north.id}><div className="flex justify-between text-xs font-bold text-[#516f90]"><span>{clientById.get(north.client_id)?.client_name}</span><span>{getElapsedDays(north.created_at)} días</span></div><div className="mt-1 h-3 bg-[#edf3f7]"><div className="h-full bg-[#7c3aed]" style={{ width: `${(getElapsedDays(north.created_at) / maxDays) * 100}%` }} /></div></div>)}</div></article></div><article className="rounded-[6px] border border-[#dfe3eb] bg-white p-4"><h3 className="font-black text-[#213343]">Esperando nuevo Norte</h3><div className="mt-3 divide-y divide-[#edf1f5]">{waiting.map((row) => <a key={row.client_id} href={`/clients/${row.client_id}`} className="flex justify-between py-3 text-sm font-bold text-[#213343]"><span>{row.client_name}</span><span className="text-[#c2410c]">Créditos pendientes: {formatNumber(row.credits_remaining)}</span></a>)}{!waiting.length ? <p className="py-4 text-sm text-[#516f90]">No hay clientes esperando un nuevo Norte.</p> : null}</div></article></div>;
}

function getElapsedDays(value: string) {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return 0;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
}

function getWeekStart(value: Date) {
  const date = new Date(value);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  date.setHours(0, 0, 0, 0);
  return date;
}

function isWithinLastDays(value: string, days: number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;

  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - days);

  return date >= start && date <= now;
}

function CustomerSuccessDashboard({
  rows,
  initiatives,
  customerSuccessConfigs,
  customerSuccessCreditGrants,
  customerSuccessOptions,
}: {
  rows: ClientHealthReportRow[];
  initiatives: InitiativeReportRow[];
  customerSuccessConfigs: CustomerSuccessConfigRow[];
  customerSuccessCreditGrants: CustomerSuccessCreditGrantRow[];
  customerSuccessOptions: Array<[string, string]>;
}) {
  const [customerSuccessId, setCustomerSuccessId] = useState("all");
  const [detail, setDetail] = useState<CustomerSuccessDetail | null>(null);
  const configByClient = useMemo(
    () => new Map(customerSuccessConfigs.map((config) => [config.client_id, config])),
    [customerSuccessConfigs],
  );
  const scopedRows = useMemo(
    () =>
      customerSuccessId === "all"
        ? rows
        : rows.filter((row) => row.customer_success_id === customerSuccessId),
    [customerSuccessId, rows],
  );
  const clientById = useMemo(
    () => new Map(scopedRows.map((row) => [row.client_id, row])),
    [scopedRows],
  );
  const scopedInitiatives = useMemo(
    () => initiatives.filter((initiative) => clientById.has(initiative.client_id)),
    [clientById, initiatives],
  );
  const activeCases = useMemo(
    () => scopedInitiatives.filter((initiative) => getElapsedDays(initiative.updated_at) <= 14),
    [scopedInitiatives],
  );
  const stagnantCases = useMemo(
    () =>
      scopedInitiatives.filter(
        (initiative) => initiative.status !== "completed" && getElapsedDays(initiative.updated_at) > 7,
      ),
    [scopedInitiatives],
  );
  const weakClients = useMemo(
    () => scopedRows.filter((row) => row.validated_evaluation_cases_count < 3),
    [scopedRows],
  );
  const completedLast30Days = useMemo(
    () => scopedInitiatives.filter((initiative) => initiative.status === "completed" && isWithinLastDays(initiative.updated_at, 30)),
    [scopedInitiatives],
  );
  const scopedCustomerSuccessOptions = useMemo(
    () =>
      customerSuccessId === "all"
        ? customerSuccessOptions
        : customerSuccessOptions.filter(([id]) => id === customerSuccessId),
    [customerSuccessId, customerSuccessOptions],
  );
  const capacityRows = useMemo(() => {
    const grouped = new Map<string, { id: string; name: string; evaluation: number; planned: number; executing: number; completed: number }>();
    scopedCustomerSuccessOptions.forEach(([id, name]) => {
      grouped.set(id, {
        id,
        name,
        evaluation: 0,
        planned: 0,
        executing: 0,
        completed: 0,
      });
    });
    scopedInitiatives.forEach((initiative) => {
      if (!isWithinLastDays(initiative.updated_at, 30)) return;

      const csmId = clientById.get(initiative.client_id)?.customer_success_id;
      if (!csmId) return;

      const current = grouped.get(csmId);
      if (!current) return;
      if (initiative.status === "backlog" && getEvaluationValidationLabel(initiative.labels) === "Validado") current.evaluation += initiative.credits;
      if (initiative.status === "planned") current.planned += initiative.credits;
      if (initiative.status === "executing") current.executing += initiative.credits;
      if (initiative.status === "completed") current.completed += initiative.credits;
    });
    return [...grouped.values()].sort((left, right) => (right.evaluation + right.planned + right.executing + right.completed) - (left.evaluation + left.planned + left.executing + left.completed) || left.name.localeCompare(right.name, "es"));
  }, [clientById, scopedCustomerSuccessOptions, scopedInitiatives]);
  const funnel = useMemo(
    () => [
      ["En evaluación", "backlog"],
      ["Planificado", "planned"],
      ["En ejecución", "executing"],
      ["Completado", "completed"],
    ].map(([label, status]) => ({ label, status, count: scopedInitiatives.filter((initiative) => initiative.status === status).length })),
    [scopedInitiatives],
  );
  const northCounts = useMemo(() => {
    const active = scopedRows.filter((row) => {
      const config = configByClient.get(row.client_id);
      return Boolean(config?.north_star_text?.trim()) && config?.north_star_lifecycle_status === "active";
    }).length;
    const fulfilled = scopedRows.filter((row) => {
      const config = configByClient.get(row.client_id);
      return Boolean(config?.north_star_text?.trim()) && config?.north_star_lifecycle_status === "fulfilled";
    }).length;
    return { active, fulfilled, inactive: scopedRows.length - active - fulfilled };
  }, [configByClient, scopedRows]);
  const weeklyCompleted = useMemo(() => {
    const currentWeek = getWeekStart(new Date());
    return Array.from({ length: 8 }, (_, index) => {
      const start = new Date(currentWeek);
      start.setDate(start.getDate() - (7 - index) * 7);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      const count = scopedInitiatives.filter((initiative) => {
        const date = new Date(initiative.updated_at);
        return initiative.status === "completed" && date >= start && date < end;
      }).length;
      return { start, count };
    });
  }, [scopedInitiatives]);
  const detailCases = detail === "active" ? activeCases : detail === "stagnant" ? stagnantCases : completedLast30Days;
  const detailTitle: Record<CustomerSuccessDetail, string> = {
    active: "Casos con avance en los últimos 14 días",
    stagnant: "Casos estancados por más de 7 días",
    weak: "Clientes con menos de 3 casos validados",
    completed: "Casos completados en los últimos 30 días",
  };
  const totalCases = scopedInitiatives.length;
  const activePercent = totalCases ? Math.round((activeCases.length / totalCases) * 100) : 0;
  const maxFunnel = Math.max(...funnel.map((item) => item.count), 1);
  const maxWeekly = Math.max(...weeklyCompleted.map((item) => item.count), 1);
  const polylinePoints = weeklyCompleted
    .map((item, index) => `${(index / Math.max(weeklyCompleted.length - 1, 1)) * 100},${100 - (item.count / maxWeekly) * 82 - 9}`)
    .join(" ");

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-[6px] border border-[#dfe3eb] bg-white p-4">
        <div>
          <h3 className="text-base font-black text-[#213343]">Desempeño de Customer Success</h3>
          <p className="mt-1 text-xs font-semibold text-[#516f90]">El filtro se aplica a todo este panel.</p>
        </div>
        <label className="space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#99acc2]">Customer Success</span>
          <select value={customerSuccessId} onChange={(event) => setCustomerSuccessId(event.target.value)} className="block h-10 min-w-56 rounded-[4px] border border-[#cbd6e2] bg-white px-3 text-sm font-bold text-[#33475b] outline-none focus:border-[#00a4bd]">
            <option value="all">Todo el equipo</option>
            {customerSuccessOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
      </div>

      <article className="overflow-hidden rounded-[6px] border border-[#dfe3eb] bg-white shadow-sm">
        <div className="border-b border-[#dfe3eb] p-4"><h3 className="flex items-center gap-1.5 text-base font-black text-[#213343]">Capacidad <InfoTooltip>Suma créditos operativos de iniciativas actualizadas en los últimos 30 días. Los casos bonificados cuentan por su valor de catálogo. En evaluación solo considera las iniciativas validadas; los porcentajes usan una base de 1,000 créditos.</InfoTooltip></h3></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-left"><thead className="bg-[#f8fbfd]"><tr className="border-b border-[#dfe3eb]">{["CS", "Completado (%)", "Comprometido (%)", "En evaluación", "Planificado", "En ejecución", "Completado", "Total"].map((heading, index) => <th key={`${heading}-${index}`} className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.14em] text-[#516f90]">{heading}</th>)}</tr></thead><tbody>{capacityRows.map((row) => { const committed = row.evaluation + row.planned + row.executing; const total = committed + row.completed; return <tr key={row.id} className="border-b border-[#edf1f5] last:border-0"><td className="px-4 py-3 text-sm font-black text-[#213343]">{row.name}</td><td className="px-4 py-3 text-sm font-black text-[#00a4bd]">{Math.round((row.completed / 1000) * 100)}%</td><td className="px-4 py-3 text-sm font-black text-[#00a4bd]">{Math.round((committed / 1000) * 100)}%</td><td className="px-4 py-3 text-sm font-bold text-[#33475b]">{formatNumber(row.evaluation)}</td><td className="px-4 py-3 text-sm font-bold text-[#33475b]">{formatNumber(row.planned)}</td><td className="px-4 py-3 text-sm font-bold text-[#33475b]">{formatNumber(row.executing)}</td><td className="px-4 py-3 text-sm font-bold text-[#33475b]">{formatNumber(row.completed)}</td><td className="px-4 py-3 text-sm font-black text-[#213343]">{formatNumber(total)}</td></tr>; })}</tbody></table></div>
      </article>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={<Activity className="h-5 w-5" />} label="Activos" value={`${activePercent}%`} description={`${formatNumber(activeCases.length)} de ${formatNumber(totalCases)} casos avanzaron en 14 días.`} tone="teal" onClick={() => setDetail("active")} />
        <MetricCard icon={<CircleAlert className="h-5 w-5" />} label="Estancados" value={formatNumber(new Set(stagnantCases.map((item) => item.client_id)).size)} description={`${formatNumber(stagnantCases.length)} casos sin avance por más de 7 días.`} tone="orange" onClick={() => setDetail("stagnant")} />
        <MetricCard icon={<UsersRound className="h-5 w-5" />} label="Débiles" value={formatNumber(weakClients.length)} description="Clientes con menos de 3 casos validados en evaluación." tone="purple" onClick={() => setDetail("weak")} />
        <MetricCard icon={<CheckCircle2 className="h-5 w-5" />} label="Completados" value={formatNumber(completedLast30Days.length)} description="Casos de uso completados en los últimos 30 días." tone="green" onClick={() => setDetail("completed")} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <article className="rounded-[6px] border border-[#dfe3eb] bg-white p-4 shadow-sm xl:col-span-2"><h3 className="flex items-center gap-1.5 text-base font-black text-[#213343]">Embudo <InfoTooltip>Cuenta casos de uso por etapa, no créditos. Incluye todos los casos del CS seleccionado, por lo que sus valores pueden diferir de Capacidad.</InfoTooltip></h3><p className="mt-1 text-xs font-semibold text-[#516f90]">Casos de uso por etapa del pipeline.</p><div className="mt-5 space-y-4">{funnel.map((item) => <div key={item.status}><div className="mb-1.5 flex justify-between text-xs font-bold text-[#516f90]"><span>{item.label}</span><span>{formatNumber(item.count)}</span></div><div className="h-8 overflow-hidden rounded-[4px] bg-[#edf3f7]"><div className="flex h-full items-center rounded-[4px] bg-[#00a4bd] px-2 text-xs font-black text-white" style={{ width: `${Math.max((item.count / maxFunnel) * 100, item.count ? 8 : 0)}%` }}>{item.count ? formatNumber(item.count) : ""}</div></div></div>)}</div></article>
        <article className="rounded-[6px] border border-[#dfe3eb] bg-white p-4 shadow-sm"><div className="flex items-center gap-2"><Target className="h-5 w-5 text-[#7c3aed]" /><h3 className="text-base font-black text-[#213343]">Estado del Norte</h3></div><p className="mt-1 text-xs font-semibold text-[#516f90]">Clientes por estado operativo del Norte.</p><div className="mt-6 flex items-center gap-5"><div className="h-28 w-28 shrink-0 rounded-full" style={{ background: `conic-gradient(#7c3aed 0 ${(northCounts.active / Math.max(scopedRows.length, 1)) * 360}deg, #16a34a 0 ${((northCounts.active + northCounts.fulfilled) / Math.max(scopedRows.length, 1)) * 360}deg, #e8eef5 0 360deg)` }}><div className="m-[18px] flex h-[76px] w-[76px] items-center justify-center rounded-full bg-white text-lg font-black text-[#213343]">{formatNumber(scopedRows.length)}</div></div><div className="space-y-3 text-sm font-bold text-[#516f90]"><p><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full bg-[#7c3aed]" />Activo: {formatNumber(northCounts.active)}</p><p><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full bg-[#16a34a]" />Cumplido: {formatNumber(northCounts.fulfilled)}</p><p><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full bg-[#dfe7f0]" />Inactivo: {formatNumber(northCounts.inactive)}</p></div></div></article>
      </div>

      <article className="rounded-[6px] border border-[#dfe3eb] bg-white p-4 shadow-sm"><h3 className="text-base font-black text-[#213343]">Tendencia de completados</h3><p className="mt-1 text-xs font-semibold text-[#516f90]">Casos completados semanalmente durante las últimas 8 semanas.</p><div className="mt-5 h-52"><svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full overflow-visible" aria-label="Tendencia semanal de casos completados"><line x1="0" x2="100" y1="91" y2="91" stroke="#dfe7f0" strokeWidth="1" /><polyline points={polylinePoints} fill="none" stroke="#00a4bd" strokeWidth="2.5" vectorEffect="non-scaling-stroke" /></svg></div><div className="grid grid-cols-4 gap-2 border-t border-[#edf1f5] pt-3 sm:grid-cols-8">{weeklyCompleted.map((week) => <div key={week.start.toISOString()} className="text-center"><p className="text-sm font-black text-[#213343]">{week.count}</p><p className="text-[9px] font-bold uppercase tracking-wide text-[#99acc2]">{week.start.toLocaleDateString("es-CO", { day: "2-digit", month: "short" })}</p></div>)}</div></article>

      {detail ? <CustomerSuccessDetailModal title={detailTitle[detail]} detail={detail} cases={detailCases} weakClients={weakClients} clientById={clientById} onClose={() => setDetail(null)} /> : null}
    </div>
  );
}

function MetricCard({ icon, label, value, description, tone, onClick }: { icon: ReactNode; label: string; value: string; description: string; tone: "teal" | "orange" | "purple" | "green"; onClick: () => void }) {
  const toneStyles = { teal: "bg-[#e5f5f8] text-[#007a8a]", orange: "bg-[#fff3e8] text-[#c2410c]", purple: "bg-[#f3e8ff] text-[#7e22ce]", green: "bg-[#eaf8ef] text-[#15803d]" };
  return <button type="button" onClick={onClick} className="rounded-[6px] border border-[#dfe3eb] bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"><span className={`flex h-10 w-10 items-center justify-center rounded-[5px] ${toneStyles[tone]}`}>{icon}</span><p className="mt-4 text-[10px] font-bold uppercase tracking-[0.14em] text-[#516f90]">{label}</p><p className="mt-1 text-3xl font-black text-[#213343]">{value}</p><p className="mt-2 text-xs font-semibold leading-relaxed text-[#516f90]">{description}</p><span className="mt-3 inline-block text-xs font-black text-[#00a4bd]">Ver detalle</span></button>;
}

function CustomerSuccessDetailModal({ title, detail, cases, weakClients, clientById, onClose }: { title: string; detail: CustomerSuccessDetail; cases: InitiativeReportRow[]; weakClients: ClientHealthReportRow[]; clientById: Map<string, ClientHealthReportRow>; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#213343]/65 p-4">
      <div role="dialog" aria-modal="true" aria-label={title} className="max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-[8px] bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-[#dfe3eb] p-5">
          <div><h3 className="text-lg font-black text-[#213343]">{title}</h3><p className="mt-1 text-sm font-semibold text-[#516f90]">{detail === "weak" ? `${formatNumber(weakClients.length)} clientes` : `${formatNumber(cases.length)} casos de uso`}</p></div>
          <button type="button" onClick={onClose} className="rounded-[4px] p-2 text-[#516f90] hover:bg-[#f5f8fa]" aria-label="Cerrar detalle"><X className="h-5 w-5" /></button>
        </div>
        <div className="max-h-[65vh] overflow-y-auto">
          {detail === "weak" ? weakClients.map((row) => <a key={row.client_id} href={`/clients/${row.client_id}`} className="flex items-center justify-between border-b border-[#edf1f5] px-5 py-4 hover:bg-[#f8fbfd]"><span className="text-sm font-black text-[#213343]">{row.client_name}</span><span className="text-xs font-bold text-[#7e22ce]">{formatNumber(row.validated_evaluation_cases_count)} validados</span></a>) : cases.map((item) => {
            const client = clientById.get(item.client_id);
            return <a key={item.id} href={`/clients/${item.client_id}`} className="flex items-center justify-between gap-4 border-b border-[#edf1f5] px-5 py-4 hover:bg-[#f8fbfd]"><div><p className="text-sm font-black text-[#213343]">{client?.client_name ?? "Cliente"}</p><p className="mt-0.5 text-xs font-semibold text-[#516f90]">{item.title}</p></div><div className="text-right"><p className="text-xs font-black capitalize text-[#00a4bd]">{item.status === "backlog" ? "En evaluación" : item.status === "planned" ? "Planificado" : item.status === "executing" ? "En ejecución" : "Completado"}</p><p className="mt-1 text-[11px] font-black text-emerald-700">{formatNumber(item.credits)} CR operativos</p>{detail === "stagnant" ? <p className="mt-1 text-[11px] font-bold text-[#c2410c]">{formatNumber(getElapsedDays(item.updated_at))} días sin avanzar</p> : null}</div></a>;
          })}
        </div>
      </div>
    </div>
  );
  /*
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#213343]/65 p-4"><div role="dialog" aria-modal="true" aria-label={title} className="max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-[8px] bg-white shadow-2xl"><div className="flex items-start justify-between border-b border-[#dfe3eb] p-5"><div><h3 className="text-lg font-black text-[#213343]">{title}</h3><p className="mt-1 text-sm font-semibold text-[#516f90]">{detail === "weak" ? `${formatNumber(weakClients.length)} clientes` : `${formatNumber(cases.length)} casos de uso`}</p></div><button type="button" onClick={onClose} className="rounded-[4px] p-2 text-[#516f90] hover:bg-[#f5f8fa]" aria-label="Cerrar detalle"><X className="h-5 w-5" /></button></div><div className="max-h-[65vh] overflow-y-auto">{detail === "weak" ? weakClients.map((row) => <a key={row.client_id} href={`/clients/${row.client_id}`} className="flex items-center justify-between border-b border-[#edf1f5] px-5 py-4 hover:bg-[#f8fbfd]"><span className="text-sm font-black text-[#213343]">{row.client_name}</span><span className="text-xs font-bold text-[#7e22ce]">{formatNumber(row.validated_evaluation_cases_count)} validados</span></a>) : cases.map((item) => { const client = clientById.get(item.client_id); return <a key={item.id} href={`/clients/${item.client_id}`} className="flex items-center justify-between gap-4 border-b border-[#edf1f5] px-5 py-4 hover:bg-[#f8fbfd]"><div><p className="text-sm font-black text-[#213343]">{client?.client_name ?? "Cliente"}</p><p className="mt-0.5 text-xs font-semibold text-[#516f90]">{item.title}</p></div><div className="text-right"><p className="text-xs font-black capitalize text-[#00a4bd]">{item.status === "backlog" ? "En evaluación" : item.status === "planned" ? "Planificado" : item.status === "executing" ? "En ejecución" : "Completado"}</p>{detail === "stagnant" ? <p className="mt-1 text-[11px] font-bold text-[#c2410c]">{formatNumber(getElapsedDays(item.updated_at))} días sin avanzar</p> : null}</div></a>)}</div></div></div>;
  */
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
  // Vacío: el panel se muestra sin subtítulo.
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
                    Días
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
  // Vacío: el panel se muestra sin subtítulo.
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
                    Días
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
  // Vacío: el panel se muestra sin subtítulo.
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
