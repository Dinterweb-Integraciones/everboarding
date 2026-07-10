"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Ban, CheckCircle2, Clock3, Gauge, ListChecks } from "lucide-react";

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

type OperationalInitiativeRow = {
  id: string;
  client_id: string;
  title: string;
  type: string | null;
  status: "backlog" | "planned" | "executing" | "completed";
  created_at: string;
  updated_at: string;
  credits: number;
};

type TeamRow = {
  id: string;
  name: string;
  clients: number;
  executing: number;
  completed: number;
  completedCredits: number;
  pending: number;
  inProgress: number;
  blocked: number;
  overdue: number;
  compliance: number | null;
  averageCycle: number | null;
};

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

function completedOnTime(task: OperationalTaskRow) {
  if (!task.target_date || task.status !== "completed") return null;
  const target = new Date(`${task.target_date}T23:59:59`).getTime();
  const completed = new Date(task.updated_at).getTime();
  if (Number.isNaN(target) || Number.isNaN(completed)) return null;
  return completed <= target;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-CO").format(value);
}

function formatPercent(value: number | null) {
  return value === null ? "—" : `${value}%`;
}

export function OperationalDashboard({ rows, initiatives, tasks, customerSuccessOptions }: {
  rows: OperationalClientRow[];
  initiatives: OperationalInitiativeRow[];
  tasks: OperationalTaskRow[];
  customerSuccessOptions: Array<[string, string]>;
}) {
  const [customerSuccessId, setCustomerSuccessId] = useState("all");
  const [clientId, setClientId] = useState("all");
  const [status, setStatus] = useState("all");
  const [category, setCategory] = useState("all");

  const clientById = useMemo(() => new Map(rows.map((row) => [row.client_id, row])), [rows]);
  const initiativeById = useMemo(() => new Map(initiatives.map((item) => [item.id, item])), [initiatives]);
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
      const datedCompleted = ownedTasks.filter((task) => completedOnTime(task) !== null);
      const completedCycles = ownedTasks.filter((task) => task.status === "completed").map((task) => daysBetween(task.created_at, task.updated_at));
      return {
        id, name, clients: ownedClients.length,
        executing: ownedInitiatives.filter((item) => item.status === "executing").length,
        completed: ownedInitiatives.filter((item) => item.status === "completed").length,
        completedCredits: ownedInitiatives.filter((item) => item.status === "completed").reduce((sum, item) => sum + item.credits, 0),
        pending: ownedTasks.filter((task) => task.status === "pending").length,
        inProgress: ownedTasks.filter((task) => task.status === "in_progress").length,
        blocked: ownedTasks.filter((task) => task.status === "blocked").length,
        overdue: ownedTasks.filter(isOverdue).length,
        compliance: datedCompleted.length ? Math.round((datedCompleted.filter((task) => completedOnTime(task)).length / datedCompleted.length) * 100) : null,
        averageCycle: completedCycles.length ? Math.round(completedCycles.reduce((sum, value) => sum + value, 0) / completedCycles.length) : null,
      };
    });
  }, [clientId, customerSuccessId, customerSuccessOptions, rows, scopedInitiatives, scopedTasks]);

  const summary = teamRows.reduce((total, row) => ({
    completed: total.completed + row.completed,
    credits: total.credits + row.completedCredits,
    inProgress: total.inProgress + row.inProgress,
    blocked: total.blocked + row.blocked,
    overdue: total.overdue + row.overdue,
  }), { completed: 0, credits: 0, inProgress: 0, blocked: 0, overdue: 0 });
  const alertTasks = scopedTasks.filter((task) => task.status === "blocked" || isOverdue(task)).sort((a, b) => {
    const aPriority = isOverdue(a) ? 1 : 0;
    const bPriority = isOverdue(b) ? 1 : 0;
    return bPriority - aPriority || daysBetween(b.created_at, new Date().toISOString()) - daysBetween(a.created_at, new Date().toISOString());
  });

  const cards = [
    { label: "Casos completados", value: summary.completed, icon: CheckCircle2, tone: "text-emerald-600 bg-emerald-50" },
    { label: "Créditos completados", value: summary.credits, icon: Gauge, tone: "text-[#007a8a] bg-[#e5f5f8]" },
    { label: "Tareas en progreso", value: summary.inProgress, icon: Clock3, tone: "text-blue-600 bg-blue-50" },
    { label: "Tareas bloqueadas", value: summary.blocked, icon: Ban, tone: "text-violet-600 bg-violet-50" },
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
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{cards.map(({ label, value, icon: Icon, tone }) => <article key={label} className="rounded-[6px] border border-[#dfe3eb] bg-white p-4 shadow-sm"><div className={`flex h-9 w-9 items-center justify-center rounded-[4px] ${tone}`}><Icon className="h-5 w-5" /></div><p className="mt-4 text-2xl font-black text-[#213343]">{formatNumber(value)}</p><p className="mt-1 text-xs font-bold text-[#516f90]">{label}</p></article>)}</div>
    <article className="overflow-x-auto rounded-[6px] border border-[#dfe3eb] bg-white shadow-sm"><div className="border-b border-[#dfe3eb] p-4"><h3 className="font-black text-[#213343]">Operatividad por CS</h3><p className="mt-1 text-xs font-semibold text-[#516f90]">Producción, carga, cumplimiento y tiempo de ciclo por responsable actual del cliente.</p></div><table className="w-full min-w-[1280px] text-left"><thead className="bg-[#f8fbfd]"><tr>{["CS", "Clientes", "Casos en ejecución", "Casos completados", "Créditos completados", "Pendientes", "En progreso", "Bloqueadas", "Vencidas", "Cumplimiento", "Ciclo promedio"].map((heading) => <th key={heading} className="px-3 py-3 text-[10px] font-bold uppercase tracking-[0.12em] text-[#516f90]">{heading}</th>)}</tr></thead><tbody>{teamRows.map((row) => <tr key={row.id} className="border-t border-[#edf1f5]"><td className="px-3 py-3 text-sm font-black text-[#213343]">{row.name}</td>{[row.clients, row.executing, row.completed, row.completedCredits, row.pending, row.inProgress, row.blocked, row.overdue].map((value, index) => <td key={index} className="px-3 py-3 text-sm font-bold text-[#33475b]">{formatNumber(value)}</td>)}<td className="px-3 py-3 text-sm font-black text-[#007a8a]">{formatPercent(row.compliance)}</td><td className="px-3 py-3 text-sm font-bold text-[#33475b]">{row.averageCycle === null ? "—" : `${row.averageCycle} días`}</td></tr>)}</tbody></table></article>
    <article className="overflow-hidden rounded-[6px] border border-[#dfe3eb] bg-white shadow-sm"><div className="border-b border-[#dfe3eb] p-4"><h3 className="flex items-center gap-2 font-black text-[#213343]"><ListChecks className="h-5 w-5 text-[#00a4bd]" />Alertas operativas</h3><p className="mt-1 text-xs font-semibold text-[#516f90]">Tareas bloqueadas o vencidas que requieren seguimiento.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left"><thead className="bg-[#f8fbfd]"><tr>{["Cliente", "CS", "Caso de uso", "Tarea", "Estado", "Fecha objetivo", "Antigüedad"].map((heading) => <th key={heading} className="px-3 py-3 text-[10px] font-bold uppercase tracking-[0.12em] text-[#516f90]">{heading}</th>)}</tr></thead><tbody>{alertTasks.slice(0, 30).map((task) => { const initiative = initiativeById.get(task.initiative_id); const client = initiative ? clientById.get(initiative.client_id) : undefined; return <tr key={task.id} className="border-t border-[#edf1f5]"><td className="px-3 py-3 text-sm font-black text-[#213343]">{client?.client_name ?? "Cliente"}</td><td className="px-3 py-3 text-sm font-semibold text-[#33475b]">{client?.customer_success_name ?? "Sin asignar"}</td><td className="px-3 py-3 text-sm font-semibold text-[#33475b]">{initiative?.title ?? "Caso"}</td><td className="px-3 py-3 text-sm text-[#516f90]">{task.name}</td><td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-xs font-black ${isOverdue(task) ? "bg-rose-50 text-rose-700" : "bg-violet-50 text-violet-700"}`}>{isOverdue(task) ? "Vencida" : "Bloqueada"}</span></td><td className="px-3 py-3 text-sm font-semibold text-[#33475b]">{task.target_date ?? "Sin fecha"}</td><td className="px-3 py-3 text-sm font-bold text-[#33475b]">{daysBetween(task.created_at, new Date().toISOString())} días</td></tr>; })}</tbody></table></div>{!alertTasks.length ? <div className="p-10 text-center text-sm font-semibold text-[#516f90]">No hay tareas bloqueadas ni vencidas para estos filtros.</div> : null}</article>
  </div>;
}
