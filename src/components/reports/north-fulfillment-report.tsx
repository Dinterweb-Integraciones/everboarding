"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, ListChecks, Target } from "lucide-react";

import type { OperationalTaskRow } from "./operational-dashboard";

type ClientRow = {
  client_id: string;
  client_name: string;
  customer_success_id: string | null;
  customer_success_name: string | null;
};

type InitiativeRow = {
  id: string;
  client_id: string;
  title: string;
  type: string | null;
  status: "backlog" | "planned" | "executing" | "completed";
  north_star_history_id: string | null;
  updated_at: string;
  credits: number;
};

type NorthRow = {
  id: string;
  client_id: string;
  north_star_text: string;
  north_star_lifecycle_status: "active" | "inactive" | "fulfilled";
  created_at: string;
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

export function NorthFulfillmentReport({ rows, initiatives, tasks, northStarHistory }: {
  rows: ClientRow[];
  initiatives: InitiativeRow[];
  tasks: OperationalTaskRow[];
  northStarHistory: NorthRow[];
}) {
  const [customerSuccessId, setCustomerSuccessId] = useState("all");
  const [clientId, setClientId] = useState("all");
  const [expandedNorths, setExpandedNorths] = useState<Set<string>>(() => new Set());

  const clientById = useMemo(() => new Map(rows.map((row) => [row.client_id, row])), [rows]);
  const tasksByInitiative = useMemo(() => {
    const grouped = new Map<string, OperationalTaskRow[]>();
    tasks.forEach((task) => grouped.set(task.initiative_id, [...(grouped.get(task.initiative_id) ?? []), task]));
    return grouped;
  }, [tasks]);
  const completedByNorth = useMemo(() => {
    const grouped = new Map<string, InitiativeRow[]>();
    initiatives.filter((initiative) => initiative.status === "completed" && initiative.north_star_history_id).forEach((initiative) => {
      const northId = initiative.north_star_history_id as string;
      grouped.set(northId, [...(grouped.get(northId) ?? []), initiative]);
    });
    return grouped;
  }, [initiatives]);
  const customerSuccessOptions = useMemo(
    () => [...new Map(rows.filter((row) => row.customer_success_id).map((row) => [row.customer_success_id as string, row.customer_success_name ?? "Sin nombre"])).entries()].sort((a, b) => a[1].localeCompare(b[1], "es")),
    [rows],
  );
  const availableClients = useMemo(
    () => rows.filter((row) => customerSuccessId === "all" || row.customer_success_id === customerSuccessId).sort((a, b) => a.client_name.localeCompare(b.client_name, "es")),
    [customerSuccessId, rows],
  );
  const fulfilledNorths = useMemo(
    () => northStarHistory.filter((north) => {
      const client = clientById.get(north.client_id);
      return north.north_star_lifecycle_status === "fulfilled" &&
        completedByNorth.has(north.id) &&
        (customerSuccessId === "all" || client?.customer_success_id === customerSuccessId) &&
        (clientId === "all" || north.client_id === clientId);
    }).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [clientById, clientId, completedByNorth, customerSuccessId, northStarHistory],
  );
  function toggleNorth(northId: string) {
    setExpandedNorths((current) => {
      const next = new Set(current);
      if (next.has(northId)) next.delete(northId);
      else next.add(northId);
      return next;
    });
  }

  return <div className="px-4 pb-4">
    <article className="overflow-hidden rounded-[6px] border border-[#dfe3eb] bg-white shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#dfe3eb] p-4">
        <div><h3 className="flex items-center gap-2 font-black text-[#213343]"><Target className="h-5 w-5 text-emerald-600" />Cumplimiento de Nortes por cliente</h3><p className="mt-1 text-xs font-semibold text-[#516f90]">Nortes cumplidos y casos vinculados, usando créditos operativos de catálogo también para los bonificados.</p></div>
        <div className="flex flex-wrap gap-2">
          <select value={customerSuccessId} onChange={(event) => { setCustomerSuccessId(event.target.value); setClientId("all"); }} className="h-10 rounded border border-[#cbd6e2] bg-white px-3 text-sm font-bold text-[#33475b]"><option value="all">Todo el equipo CS</option>{customerSuccessOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
          <select value={clientId} onChange={(event) => setClientId(event.target.value)} className="h-10 max-w-56 rounded border border-[#cbd6e2] bg-white px-3 text-sm font-bold text-[#33475b]"><option value="all">Todos los clientes</option>{availableClients.map((client) => <option key={client.client_id} value={client.client_id}>{client.client_name}</option>)}</select>
        </div>
      </div>
      <div className="divide-y divide-[#edf1f5]">{fulfilledNorths.map((north) => {
        const client = clientById.get(north.client_id);
        const cases = completedByNorth.get(north.id) ?? [];
        const isExpanded = expandedNorths.has(north.id);
        const taskCount = cases.reduce((sum, initiative) => sum + (tasksByInitiative.get(initiative.id)?.length ?? 0), 0);
        const credits = cases.reduce((sum, initiative) => sum + initiative.credits, 0);
        return <div key={north.id}>
          <button type="button" onClick={() => toggleNorth(north.id)} className="grid w-full gap-3 p-4 text-left transition hover:bg-[#f8fbfd] md:grid-cols-[24px_minmax(180px,0.7fr)_minmax(260px,1.5fr)_130px_110px_110px] md:items-center">
            {isExpanded ? <ChevronDown className="h-5 w-5 text-[#516f90]" /> : <ChevronRight className="h-5 w-5 text-[#516f90]" />}
            <div><p className="text-sm font-black text-[#213343]">{client?.client_name ?? "Cliente"}</p><p className="text-xs font-semibold text-[#516f90]">{client?.customer_success_name ?? "Sin asignar"}</p></div>
            <p className="text-sm font-semibold text-[#33475b]">{north.north_star_text}</p>
            <span className="text-xs font-bold text-[#516f90]">{formatDate(cases.reduce((latest, item) => new Date(item.updated_at) > new Date(latest) ? item.updated_at : latest, cases[0]?.updated_at ?? north.created_at))}</span>
            <span className="text-xs font-black text-[#007a8a]">{cases.length} casos</span>
            <span className="text-xs font-black text-emerald-700">{taskCount} tareas · {credits} CR</span>
          </button>
          {isExpanded ? <div className="border-t border-[#edf1f5] bg-[#fbfdfe] px-4 py-3 md:pl-14">{cases.map((initiative) => {
            const initiativeTasks = tasksByInitiative.get(initiative.id) ?? [];
            return <div key={initiative.id} className="mb-3 rounded-[4px] border border-[#dfe3eb] bg-white p-3 last:mb-0"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-black text-[#213343]">{initiative.title}</p><p className="text-xs font-semibold text-[#516f90]">{initiative.type ?? "Sin categoría"} · Completado {formatDate(initiative.updated_at)}</p></div><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-black text-emerald-700">{initiative.credits} CR</span></div><div className="mt-3 grid gap-2 md:grid-cols-2">{initiativeTasks.map((task) => <div key={task.id} className="flex items-center gap-2 rounded-[4px] bg-[#f5f8fa] px-3 py-2 text-xs font-semibold text-[#33475b]"><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /><span className="flex-1">{task.name}</span><span className="text-[#516f90]">{task.quantity} × {task.unit_credits} CR</span></div>)}{!initiativeTasks.length ? <p className="text-xs font-semibold text-[#99acc2]">Este caso no tiene tareas registradas.</p> : null}</div></div>;
          })}</div> : null}
        </div>;
      })}</div>
      {!fulfilledNorths.length ? <div className="flex flex-col items-center gap-2 p-10 text-center"><ListChecks className="h-7 w-7 text-[#99acc2]" /><p className="text-sm font-black text-[#213343]">Sin Nortes cumplidos asociados</p><p className="text-sm font-semibold text-[#516f90]">No hay casos completados vinculados a Nortes cumplidos para estos filtros.</p></div> : null}
    </article>
  </div>;
}
