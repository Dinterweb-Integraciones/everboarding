"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, BarChart3, Check, CheckCircle2, Gauge } from "lucide-react";

import { normalizeInitiativeTitle } from "@/lib/onboarding";

export type OperationalTaskRow = {
  id: string;
  initiative_id: string;
  name: string;
  status: "pending" | "in_progress" | "blocked" | "completed";
  target_date: string | null;
  unit_credits: number;
  quantity: number;
  created_at: string;
  updated_at: string;
};

type OperationalClientRow = {
  client_id: string;
  client_name: string;
  customer_success_id: string | null;
  customer_success_name: string | null;
};

export type OperationalTransitionClientRow = {
  id: string;
  client_id: string | null;
  client_name: string;
  customer_success_id: string | null;
  customer_success_name: string | null;
  paid_at: string | null;
  assigned_at: string | null;
};

type OperationalInitiativeRow = {
  id: string;
  client_id: string;
  title: string;
  type: string | null;
  status: "backlog" | "planned" | "executing" | "completed";
  created_at: string;
  updated_at: string;
  executing_at: string | null;
  completed_at: string | null;
  credits: number;
};

type OperationalTransitionRow = {
  id: string;
  clientId: string | null;
  clientName: string;
  customerSuccessName: string | null;
  paidAt: string | null;
  assignedAt: string | null;
  kickoffCompletedAt: string | null;
  firstExecutingAt: string | null;
  firstExecutingCompletedAt: string | null;
};

type TeamRow = {
  id: string;
  name: string;
  clients: number;
  executing: number;
  completed: number;
  completedCredits: number;
  pending: number;
  overdue: number;
};

type ClientStageRow = {
  id: string;
  clientName: string;
  customerSuccessName: string;
  backlog: number;
  planned: number;
  executing: number;
  completed: number;
  total: number;
};

type ClientStageSortKey = keyof Omit<ClientStageRow, "id">;
type SortDirection = "desc" | "asc";

const DAY_MS = 86_400_000;

function daysBetween(start: string, end: string) {
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  if (Number.isNaN(startTime) || Number.isNaN(endTime)) return 0;
  return Math.max(0, Math.floor((endTime - startTime) / DAY_MS));
}

function isOverdue(task: OperationalTaskRow) {
  if (!task.target_date || task.status === "completed") return false;
  const target = new Date(`${task.target_date}T23:59:59`).getTime();
  return !Number.isNaN(target) && target < Date.now();
}

function isKickoffInitiative(initiative: Pick<OperationalInitiativeRow, "title" | "type">) {
  const normalized = normalizeInitiativeTitle(`${initiative.title} ${initiative.type ?? ""}`);
  const compact = normalized.replace(/[^a-z0-9]/g, "");

  return compact.includes("kickoff") || normalized.includes("kick off");
}

function getTransitionDays(start: string | null, end: string | null) {
  if (!start) return 0;
  return daysBetween(start, end ?? new Date().toISOString());
}

function TransitionStage({
  days,
  completed,
  active,
  label,
}: {
  days: number;
  completed: boolean;
  active: boolean;
  label: string;
}) {
  const arrowClipPath = "polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%, 10px 50%)";

  return (
    <div
      className={`h-8 min-w-24 flex-1 ${active ? "bg-[#213343] p-px" : completed ? "bg-[#213343]" : "bg-[#f1f3f5]"}`}
      style={{ clipPath: arrowClipPath }}
      title={`${label}: ${days} días${completed ? " · Completada" : " · Pendiente"}`}
      aria-label={`${label}: ${days} días, ${completed ? "completada" : "pendiente"}`}
    >
      <div
        className={`flex h-full w-full items-center justify-center gap-1.5 px-4 text-xs font-black ${
          completed ? "bg-[#213343] text-white" : active ? "bg-white text-[#213343]" : "bg-[#f1f3f5] text-[#516f90]"
        }`}
        style={{ clipPath: arrowClipPath }}
      >
        {completed ? <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={3} aria-hidden="true" /> : null}
        <span>{days} días</span>
      </div>
    </div>
  );
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-CO").format(value);
}

export function OperationalDashboard({ rows, initiatives, tasks, customerSuccessOptions, transitionClients }: {
  rows: OperationalClientRow[];
  initiatives: OperationalInitiativeRow[];
  tasks: OperationalTaskRow[];
  customerSuccessOptions: Array<[string, string]>;
  transitionClients: OperationalTransitionClientRow[];
}) {
  const [customerSuccessId, setCustomerSuccessId] = useState("all");
  const [clientId, setClientId] = useState("all");
  const [status, setStatus] = useState("all");
  const [category, setCategory] = useState("all");
  const [clientStageSort, setClientStageSort] = useState<{
    key: ClientStageSortKey;
    direction: SortDirection;
  }>({ key: "total", direction: "desc" });

  const clientById = useMemo(() => new Map(rows.map((row) => [row.client_id, row])), [rows]);
  const categories = useMemo(
    () => [...new Set(initiatives.map((item) => item.type).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "es")),
    [initiatives],
  );
  const availableClients = useMemo(
    () => rows.filter((row) => customerSuccessId === "all" || row.customer_success_id === customerSuccessId).sort((a, b) => a.client_name.localeCompare(b.client_name, "es")),
    [customerSuccessId, rows],
  );
  const scopedInitiatives = useMemo(() => initiatives.filter((item) => {
    const client = clientById.get(item.client_id);
    return (customerSuccessId === "all" || client?.customer_success_id === customerSuccessId) &&
      (clientId === "all" || item.client_id === clientId) &&
      (category === "all" || item.type === category);
  }), [category, clientById, clientId, customerSuccessId, initiatives]);
  const scopedInitiativeIds = useMemo(() => new Set(scopedInitiatives.map((item) => item.id)), [scopedInitiatives]);
  const scopedTasks = useMemo(() => tasks.filter((task) => scopedInitiativeIds.has(task.initiative_id) && (status === "all" || task.status === status)), [scopedInitiativeIds, status, tasks]);

  const teamRows = useMemo<TeamRow[]>(() => {
    const options = customerSuccessId === "all"
      ? customerSuccessOptions
      : customerSuccessOptions.filter(([id]) => id === customerSuccessId);
    return options.map(([id, name]) => {
      const ownedClients = rows.filter((row) => row.customer_success_id === id && (clientId === "all" || row.client_id === clientId));
      const ownedClientIds = new Set(ownedClients.map((row) => row.client_id));
      const ownedInitiatives = scopedInitiatives.filter((item) => ownedClientIds.has(item.client_id));
      const ownedInitiativeIds = new Set(ownedInitiatives.map((item) => item.id));
      const ownedTasks = scopedTasks.filter((task) => ownedInitiativeIds.has(task.initiative_id));
      return {
        id, name, clients: ownedClients.length,
        executing: ownedInitiatives.filter((item) => item.status === "executing").length,
        completed: ownedInitiatives.filter((item) => item.status === "completed").length,
        completedCredits: ownedInitiatives.filter((item) => item.status === "completed").reduce((sum, item) => sum + item.credits, 0),
        pending: ownedTasks.filter((task) => task.status === "pending").length,
        overdue: ownedTasks.filter(isOverdue).length,
      };
    });
  }, [clientId, customerSuccessId, customerSuccessOptions, rows, scopedInitiatives, scopedTasks]);

  const transitionRows = useMemo<OperationalTransitionRow[]>(() => {
    const candidates = transitionClients.map((client) => ({
      id: client.id,
      clientId: client.client_id,
      clientName: client.client_name,
      customerSuccessId: client.customer_success_id,
      customerSuccessName: client.customer_success_name,
      paidAt: client.paid_at,
      assignedAt: client.assigned_at,
    }));

    return candidates
      .filter(
        (client) =>
          (customerSuccessId === "all" || client.customerSuccessId === customerSuccessId) &&
          (clientId === "all" || client.clientId === clientId),
      )
      .map((client) => {
        const clientInitiatives = initiatives.filter(
          (initiative) => initiative.client_id === client.clientId,
        );
        const kickoffCompletedAt = clientInitiatives
          .filter((initiative) => isKickoffInitiative(initiative) && initiative.completed_at)
          .map((initiative) => initiative.completed_at as string)
          .sort((first, second) => new Date(first).getTime() - new Date(second).getTime())[0] ?? null;
        const firstExecutingCase = clientInitiatives
          .filter((initiative) => !isKickoffInitiative(initiative) && initiative.executing_at)
          .sort(
            (first, second) =>
              new Date(first.executing_at as string).getTime() -
              new Date(second.executing_at as string).getTime(),
          )[0];

        return {
          id: client.id,
          clientId: client.clientId,
          clientName: client.clientName,
          customerSuccessName: client.customerSuccessName,
          paidAt: client.paidAt,
          assignedAt: client.assignedAt,
          kickoffCompletedAt,
          firstExecutingAt: firstExecutingCase?.executing_at ?? null,
          firstExecutingCompletedAt: firstExecutingCase?.completed_at ?? null,
        };
      })
      .sort((first, second) =>
        first.clientName.localeCompare(second.clientName, "es"),
      );
  }, [clientId, customerSuccessId, initiatives, transitionClients]);

  const clientStageRows = useMemo<ClientStageRow[]>(() => {
    const filteredClients = rows.filter((client) =>
      (customerSuccessId === "all" || client.customer_success_id === customerSuccessId) &&
      (clientId === "all" || client.client_id === clientId),
    );

    const stageRows = filteredClients.map((client) => {
      const clientInitiatives = scopedInitiatives.filter(
        (initiative) => initiative.client_id === client.client_id,
      );
      const backlog = clientInitiatives.filter((initiative) => initiative.status === "backlog").length;
      const planned = clientInitiatives.filter((initiative) => initiative.status === "planned").length;
      const executing = clientInitiatives.filter((initiative) => initiative.status === "executing").length;
      const completed = clientInitiatives.filter((initiative) => initiative.status === "completed").length;

      return {
        id: client.client_id,
        clientName: client.client_name,
        customerSuccessName: client.customer_success_name ?? "Sin asignar",
        backlog,
        planned,
        executing,
        completed,
        total: backlog + planned + executing + completed,
      };
    });

    return stageRows.sort((left, right) => {
      const leftValue = left[clientStageSort.key];
      const rightValue = right[clientStageSort.key];
      const comparison = typeof leftValue === "number" && typeof rightValue === "number"
        ? leftValue - rightValue
        : String(leftValue).localeCompare(String(rightValue), "es");
      const directedComparison = clientStageSort.direction === "asc" ? comparison : -comparison;

      return directedComparison || left.clientName.localeCompare(right.clientName, "es");
    });
  }, [clientId, clientStageSort, customerSuccessId, rows, scopedInitiatives]);

  function changeClientStageSort(key: ClientStageSortKey) {
    setClientStageSort((current) => ({
      key,
      direction: current.key === key && current.direction === "desc" ? "asc" : "desc",
    }));
  }

  const summary = teamRows.reduce((total, row) => ({
    completed: total.completed + row.completed,
    credits: total.credits + row.completedCredits,
    overdue: total.overdue + row.overdue,
  }), { completed: 0, credits: 0, overdue: 0 });
  const cards = [
    { label: "Casos completados", value: summary.completed, icon: CheckCircle2, tone: "text-emerald-600 bg-emerald-50" },
    { label: "Créditos completados", value: summary.credits, icon: Gauge, tone: "text-[#007a8a] bg-[#e5f5f8]" },
    { label: "Tareas vencidas", value: summary.overdue, icon: AlertTriangle, tone: "text-rose-600 bg-rose-50" },
  ];

  return <div className="space-y-4 p-4">
    <div className="flex flex-wrap items-end justify-between gap-3 rounded-[6px] border border-[#dfe3eb] bg-white p-4">
      <div><h3 className="font-black text-[#213343]">Operatividad del equipo</h3><p className="mt-1 text-xs font-semibold text-[#516f90]">Los tiempos representan días transcurridos entre creación y última actualización, no horas trabajadas.</p></div>
      <div className="flex flex-wrap gap-2">
        <select value={customerSuccessId} onChange={(event) => { setCustomerSuccessId(event.target.value); setClientId("all"); }} className="h-10 rounded border border-[#cbd6e2] bg-white px-3 text-sm font-bold text-[#33475b]"><option value="all">Todo el equipo CS</option>{customerSuccessOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
        <select value={clientId} onChange={(event) => setClientId(event.target.value)} className="h-10 max-w-56 rounded border border-[#cbd6e2] bg-white px-3 text-sm font-bold text-[#33475b]"><option value="all">Todos los clientes</option>{availableClients.map((client) => <option key={client.client_id} value={client.client_id}>{client.client_name}</option>)}</select>
        <select value={category} onChange={(event) => setCategory(event.target.value)} className="h-10 rounded border border-[#cbd6e2] bg-white px-3 text-sm font-bold text-[#33475b]"><option value="all">Todas las categorías</option>{categories.map((value) => <option key={value} value={value}>{value}</option>)}</select>
        <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-10 rounded border border-[#cbd6e2] bg-white px-3 text-sm font-bold text-[#33475b]"><option value="all">Todos los estados</option><option value="pending">Pendiente</option><option value="in_progress">En progreso</option><option value="blocked">Bloqueada</option><option value="completed">Completada</option></select>
      </div>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{cards.map(({ label, value, icon: Icon, tone }) => <article key={label} className="rounded-[6px] border border-[#dfe3eb] bg-white p-4 shadow-sm"><div className={`flex h-9 w-9 items-center justify-center rounded-[4px] ${tone}`}><Icon className="h-5 w-5" /></div><p className="mt-4 text-2xl font-black text-[#213343]">{formatNumber(value)}</p><p className="mt-1 text-xs font-bold text-[#516f90]">{label}</p></article>)}</div>
    <article className="overflow-x-auto rounded-[6px] border border-[#dfe3eb] bg-white shadow-sm"><div className="border-b border-[#dfe3eb] p-4"><h3 className="font-black text-[#213343]">Operatividad por CS</h3><p className="mt-1 text-xs font-semibold text-[#516f90]">Producción y carga por responsable actual del cliente.</p></div><table className="w-full min-w-[900px] text-left"><thead className="bg-[#f8fbfd]"><tr>{["CS", "Clientes", "Casos en ejecución", "Casos completados", "Créditos completados", "Pendientes", "Vencidas"].map((heading) => <th key={heading} className="px-3 py-3 text-[10px] font-bold uppercase tracking-[0.12em] text-[#516f90]">{heading}</th>)}</tr></thead><tbody>{teamRows.map((row) => <tr key={row.id} className="border-t border-[#edf1f5]"><td className="px-3 py-3 text-sm font-black text-[#213343]">{row.name}</td>{[row.clients, row.executing, row.completed, row.completedCredits, row.pending, row.overdue].map((value, index) => <td key={index} className="px-3 py-3 text-sm font-bold text-[#33475b]">{formatNumber(value)}</td>)}</tr>)}</tbody></table></article>
    <article className="overflow-x-auto rounded-[6px] border border-[#dfe3eb] bg-white shadow-sm">
      <div className="border-b border-[#dfe3eb] p-4">
        <h3 className="font-black text-[#213343]">Tiempos de transición por cliente</h3>
        <p className="mt-1 text-xs font-semibold text-[#516f90]">Cada etapa muestra sus días transcurridos. El check indica que la etapa ya fue completada.</p>
      </div>
      <table className="w-full min-w-[1050px] text-left">
        <thead className="bg-[#f8fbfd]">
          <tr>
            {["Cliente", "CS", "Pago → asignación", "Asignación → kickoff", "Kickoff → caso en ejecución", "Caso en ejecución → completado"].map((heading) => (
              <th key={heading} className="px-3 py-3 text-[10px] font-bold uppercase tracking-[0.12em] text-[#516f90]">{heading}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {transitionRows.map((row) => {
            const stages = [
              { label: "Pago a asignación", start: row.paidAt, end: row.assignedAt },
              { label: "Asignación a kickoff", start: row.assignedAt, end: row.kickoffCompletedAt },
              { label: "Kickoff a caso en ejecución", start: row.kickoffCompletedAt, end: row.firstExecutingAt },
              { label: "Caso en ejecución a completado", start: row.firstExecutingAt, end: row.firstExecutingCompletedAt },
            ];
            const firstPendingStage = stages.findIndex((stage) => !stage.end);

            return (
              <tr key={row.id} className="border-t border-[#edf1f5]">
                <td className="px-3 py-3 text-sm font-black text-[#213343]">
                  {row.clientId ? <a href={`/clients/${row.clientId}`} className="hover:text-[#007a8a]">{row.clientName}</a> : row.clientName}
                </td>
                <td className="px-3 py-3 text-sm font-semibold text-[#33475b]">{row.customerSuccessName ?? "Sin asignar"}</td>
                {stages.map((stage, index) => (
                  <td key={stage.label} className="px-0 py-3">
                    <TransitionStage
                      label={stage.label}
                      days={getTransitionDays(stage.start, stage.end)}
                      completed={Boolean(stage.end)}
                      active={index === firstPendingStage}
                    />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {!transitionRows.length ? <div className="p-10 text-center text-sm font-semibold text-[#516f90]">No hay clientes para los filtros seleccionados.</div> : null}
    </article>
    <article className="overflow-hidden rounded-[6px] border border-[#dfe3eb] bg-white shadow-sm">
      <div className="border-b border-[#dfe3eb] p-4">
        <h3 className="flex items-center gap-2 font-black text-[#213343]"><BarChart3 className="h-5 w-5 text-[#00a4bd]" />Casos por etapa y cliente</h3>
        <p className="mt-1 text-xs font-semibold text-[#516f90]">Selecciona una columna para ordenar primero de mayor a menor y luego de menor a mayor.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[850px] text-left">
          <thead className="bg-[#f8fbfd]">
            <tr>
              {([
                ["clientName", "Cliente"],
                ["customerSuccessName", "CS"],
                ["backlog", "En evaluación"],
                ["planned", "Planificados"],
                ["executing", "En ejecución"],
                ["completed", "Completados"],
                ["total", "Total"],
              ] as Array<[ClientStageSortKey, string]>).map(([key, label]) => {
                const selected = clientStageSort.key === key;
                const SortIcon = selected && clientStageSort.direction === "asc" ? ArrowUp : ArrowDown;

                return (
                  <th key={key} className="px-3 py-3">
                    <button
                      type="button"
                      onClick={() => changeClientStageSort(key)}
                      className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] hover:text-[#007a8a] ${selected ? "text-[#007a8a]" : "text-[#516f90]"}`}
                      aria-label={`Ordenar por ${label}${selected ? `, orden ${clientStageSort.direction === "desc" ? "descendente" : "ascendente"}` : ""}`}
                    >
                      {label}
                      <SortIcon className={`h-3.5 w-3.5 ${selected ? "opacity-100" : "opacity-35"}`} aria-hidden="true" />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {clientStageRows.map((row) => (
              <tr key={row.id} className="border-t border-[#edf1f5] hover:bg-[#f8fbfd]">
                <td className="px-3 py-3 text-sm font-black text-[#213343]"><a href={`/clients/${row.id}`} className="hover:text-[#007a8a]">{row.clientName}</a></td>
                <td className="px-3 py-3 text-sm font-semibold text-[#33475b]">{row.customerSuccessName}</td>
                <td className="px-3 py-3 text-sm font-bold text-[#516f90]">{formatNumber(row.backlog)}</td>
                <td className="px-3 py-3 text-sm font-bold text-[#516f90]">{formatNumber(row.planned)}</td>
                <td className="px-3 py-3 text-sm font-bold text-[#00a4bd]">{formatNumber(row.executing)}</td>
                <td className="px-3 py-3 text-sm font-bold text-emerald-600">{formatNumber(row.completed)}</td>
                <td className="px-3 py-3 text-sm font-black text-[#213343]">{formatNumber(row.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!clientStageRows.length ? <div className="p-10 text-center text-sm font-semibold text-[#516f90]">No hay clientes para los filtros seleccionados.</div> : null}
    </article>
  </div>;
}
