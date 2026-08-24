"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowDownAZ,
  ArrowDownWideNarrow,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  CircleHelp,
  Search,
  Table2,
  Target,
  UsersRound,
  X,
} from "lucide-react";

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
  credit_renewal_at: string | null;
  days_until_credit_renewal: number | null;
};
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
  expires_at: string;
};
type CustomerSuccessProfileRow = {
  id: string;
  full_name: string | null;
  email: string;
};
type CreditHistoryReportRow = {
  clientId: string;
  clientName: string;
  customerSuccessId: string | null;
  customerSuccessName: string | null;
  billing: "paquetes" | "recurrencia";
  totalContractedCredits: number;
  availableCredits: number;
  planningCredits: number;
  executingCredits: number;
  remainingCredits: number;
  evaluationCredits: number;
  completedCredits: number;
  kickoffCompletedAt: string | null;
  daysSinceKickoff: number | null;
  renewalAt: string | null;
  daysUntilRenewal: number | null;
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
    label: "Historial de Créditos",
    title: "Historial de Créditos",
    description: "Créditos comprados o contratados, disponibilidad, consumo y próximas renovaciones.",
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
  operationalTasks,
  operationalTransitionClients,
  customerSuccessConfigs,
  customerSuccessCreditGrants,
  customerSuccessProfiles,
  northStarHistory,
  northStarAudits,
  canAuditNorths = true,
}: {
  rows: ClientHealthReportRow[];
  initiatives: InitiativeReportRow[];
  operationalTasks: OperationalTaskRow[];
  operationalTransitionClients: OperationalTransitionClientRow[];
  customerSuccessConfigs: CustomerSuccessConfigRow[];
  customerSuccessCreditGrants: CustomerSuccessCreditGrantRow[];
  customerSuccessProfiles: CustomerSuccessProfileRow[];
  northStarHistory: NorthHistoryRow[];
  northStarAudits: Array<Record<string, unknown>>;
  canAuditNorths?: boolean;
}) {
  const [selectedPanelKey, setSelectedPanelKey] = useState<PanelKey>("clients");
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
  const initiativeCreditTotals = useMemo(() => {
    const completedByClient = new Map<string, number>();
    const planningByClient = new Map<string, number>();
    const executingByClient = new Map<string, number>();
    const evaluationByClient = new Map<string, number>();

    initiatives.forEach((initiative) => {
      const credits = Number(initiative.credits) || 0;
      const byStatus = {
        completed: completedByClient,
        planned: planningByClient,
        executing: executingByClient,
        backlog: evaluationByClient,
      }[initiative.status];
      byStatus.set(initiative.client_id, (byStatus.get(initiative.client_id) ?? 0) + credits);
    });

    return { completedByClient, planningByClient, executingByClient, evaluationByClient };
  }, [initiatives]);
  const creditHistoryRows = useMemo(() => {
    const grantedCreditsByClient = new Map<string, number>();
    customerSuccessCreditGrants.forEach((grant) => {
      grantedCreditsByClient.set(
        grant.client_id,
        (grantedCreditsByClient.get(grant.client_id) ?? 0) + Number(grant.granted_credits),
      );
    });

    return rows
      .map((row) => {
        const availableCredits = Number(row.credits_remaining) || 0;
        const planningCredits = initiativeCreditTotals.planningByClient.get(row.client_id) ?? 0;
        const executingCredits = initiativeCreditTotals.executingByClient.get(row.client_id) ?? 0;

        return {
          clientId: row.client_id,
          clientName: row.client_name,
          customerSuccessId: row.customer_success_id,
          customerSuccessName: row.customer_success_name,
          billing: row.billing,
          totalContractedCredits:
            row.billing === "paquetes"
              ? grantedCreditsByClient.get(row.client_id) ?? 0
              : row.contracted_credits,
          availableCredits,
          planningCredits,
          executingCredits,
          remainingCredits: availableCredits + planningCredits + executingCredits,
          evaluationCredits: initiativeCreditTotals.evaluationByClient.get(row.client_id) ?? 0,
          completedCredits: initiativeCreditTotals.completedByClient.get(row.client_id) ?? 0,
          kickoffCompletedAt: row.kickoff_completed_at,
          daysSinceKickoff: row.days_since_kickoff_completed,
          renewalAt: row.credit_renewal_at,
          daysUntilRenewal: row.days_until_credit_renewal,
        };
      })
      .sort(
        (first, second) =>
          (first.customerSuccessName ?? "Sin asignar").localeCompare(
            second.customerSuccessName ?? "Sin asignar",
            "es",
          )
          || first.clientName.localeCompare(second.clientName, "es"),
      ) satisfies CreditHistoryReportRow[];
  }, [customerSuccessCreditGrants, initiativeCreditTotals, rows]);

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
            <CreditHistoryReport rows={creditHistoryRows} />
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

function CreditHistoryReport({ rows }: { rows: CreditHistoryReportRow[] }) {
  const [searchTerm, setSearchTerm] = useState("");

  const groups = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const byCs = new Map<string, { csId: string | null; csName: string; clients: CreditHistoryReportRow[] }>();

    rows.forEach((row) => {
      if (normalizedSearch && !row.clientName.toLowerCase().includes(normalizedSearch)) return;

      const key = row.customerSuccessId ?? "__unassigned__";
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
        const clients = [...group.clients].sort((first, second) =>
          first.clientName.localeCompare(second.clientName, "es"),
        );
        return {
          ...group,
          clients,
          recurringContracted: clients
            .filter((row) => row.billing === "recurrencia")
            .reduce((sum, row) => sum + row.totalContractedCredits, 0),
          packageContracted: clients
            .filter((row) => row.billing === "paquetes")
            .reduce((sum, row) => sum + row.totalContractedCredits, 0),
        };
      })
      .sort((first, second) => first.csName.localeCompare(second.csName, "es"));
  }, [rows, searchTerm]);

  const totalClients = groups.reduce((sum, group) => sum + group.clients.length, 0);

  return (
    <article className="overflow-hidden rounded-[6px] border border-[#dfe3eb] bg-white shadow-sm">
      <div className="flex flex-col gap-4 border-b border-[#dfe3eb] p-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-black text-[#213343]">Historial de créditos por cliente</h3>
            <InfoTooltip>
              Restantes suma disponibles + en planificación + en ejecución. En evaluación corresponde a
              casos aún no aprobados (backlog). Completados incluye casos terminados. La tabla agrupa a
              cada cliente bajo su Customer Success.
            </InfoTooltip>
          </div>
          <p className="mt-1 text-xs font-semibold text-[#516f90]">
            Agrupado por Customer Success, en orden alfabético.
          </p>
        </div>

        <label className="w-full space-y-1.5 lg:max-w-sm">
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#99acc2]">
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

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1520px] border-collapse text-left">
          <thead className="bg-[#f8fbfd]">
            <tr className="border-b border-[#dfe3eb]">
              {[
                "CS",
                "Cliente",
                "Tipo de servicio",
                "Créditos contratados",
                "Disponibles",
                "En planificación",
                "En ejecución",
                "Restantes",
                "En evaluación",
                "Completados",
                "Fecha clave",
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
            {groups.map((group) => (
              <Fragment key={group.csId ?? "__unassigned__"}>
                {group.clients.map((row, rowIndex) => (
                  <tr key={row.clientId} className="border-b border-[#edf1f5] last:border-b-0 hover:bg-[#f8fbfd]">
                    {rowIndex === 0 ? (
                      <td
                        rowSpan={group.clients.length}
                        className="border-r border-[#edf1f5] bg-[#f8fbfd] px-4 py-4 align-top"
                      >
                        <p className="text-sm font-black text-[#213343]">{group.csName}</p>
                        <p className="mt-1 text-xs font-bold text-[#516f90]">
                          {group.clients.length} {group.clients.length === 1 ? "cliente" : "clientes"}
                        </p>
                        <p className="mt-2 text-xs font-semibold text-[#516f90]">
                          Recurrentes:{" "}
                          <strong className="text-[#213343]">{formatNumber(group.recurringContracted)} CR</strong>
                        </p>
                        <p className="mt-1 text-xs font-semibold text-[#516f90]">
                          Paquetes:{" "}
                          <strong className="text-[#213343]">{formatNumber(group.packageContracted)} CR</strong>
                        </p>
                        <p className="mt-1 text-xs font-semibold text-[#516f90]">
                          Total:{" "}
                          <strong className="text-[#213343]">
                            {formatNumber(group.recurringContracted + group.packageContracted)} CR
                          </strong>
                        </p>
                      </td>
                    ) : null}
                    <td className="px-4 py-4">
                      <a
                        href={`/clients/${row.clientId}`}
                        className="text-sm font-black text-[#213343] hover:text-[#00a4bd]"
                      >
                        {row.clientName}
                      </a>
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
                    <td className="px-4 py-4 text-sm font-black text-[#213343]">
                      {formatNumber(row.totalContractedCredits)} CR
                    </td>
                    <td className="px-4 py-4">
                      <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-sm font-black text-emerald-700">
                        {formatNumber(row.availableCredits)} CR
                      </span>
                    </td>
                    <td className="px-4 py-4 text-sm font-bold text-[#33475b]">
                      {formatNumber(row.planningCredits)} CR
                    </td>
                    <td className="px-4 py-4 text-sm font-bold text-[#33475b]">
                      {formatNumber(row.executingCredits)} CR
                    </td>
                    <td className="px-4 py-4 text-sm font-black text-[#213343]">
                      {formatNumber(row.remainingCredits)} CR
                    </td>
                    <td className="px-4 py-4 text-sm font-bold text-[#33475b]">
                      {formatNumber(row.evaluationCredits)} CR
                    </td>
                    <td className="px-4 py-4 text-sm font-bold text-[#33475b]">
                      {formatNumber(row.completedCredits)} CR
                    </td>
                    <td className="px-4 py-4">
                      {row.billing === "paquetes" ? (
                        row.daysSinceKickoff === null ? (
                          <span className="text-sm font-semibold text-[#99acc2]">Kickoff pendiente</span>
                        ) : (
                          <div>
                            <p className="text-sm font-black text-[#213343]">
                              {formatNumber(row.daysSinceKickoff)} días desde kickoff
                            </p>
                            {row.kickoffCompletedAt ? (
                              <p className="mt-0.5 text-xs font-semibold text-[#516f90]">
                                Desde {formatDate(row.kickoffCompletedAt.slice(0, 10))}
                              </p>
                            ) : null}
                          </div>
                        )
                      ) : row.daysUntilRenewal === null ? (
                        <span className="text-sm font-semibold text-[#99acc2]">Sin fecha de renovación</span>
                      ) : (
                        <div>
                          <p
                            className={`text-sm font-black ${
                              row.daysUntilRenewal < 0 ? "text-rose-600" : "text-[#213343]"
                            }`}
                          >
                            {row.daysUntilRenewal < 0
                              ? `Vencida hace ${formatNumber(Math.abs(row.daysUntilRenewal))} días`
                              : row.daysUntilRenewal === 0
                                ? "Renueva hoy"
                                : `${formatNumber(row.daysUntilRenewal)} días para renovar`}
                          </p>
                          {row.renewalAt ? (
                            <p className="mt-0.5 text-xs font-semibold text-[#516f90]">
                              {row.daysUntilRenewal < 0 ? "Renovaba" : "Renueva"} el {formatDate(row.renewalAt)}
                            </p>
                          ) : null}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
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
