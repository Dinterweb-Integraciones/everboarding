"use client";

import { Map as MapIcon, Search, X } from "lucide-react";
import { useMemo, useState } from "react";

import { EmojiPicker } from "@/components/cs/emoji-picker";
import { Input } from "@/components/ui/input";
import {
  CLIENT_USE_CASE_STATUS_COLORS,
  type ClientUseCaseDisplayStatus,
} from "@/lib/client-use-case-status";
import type { CreditCatalogGroup } from "@/lib/onboarding";
import { normalizeReference, wrapStarLabel, type GraphEdge } from "@/lib/use-case-graph";
import { cn } from "@/lib/utils";

export type RouteItem = { groupId: string; icon: string };

export const DEFAULT_NODE_ICON = "🧩";
export const MAX_MAP_NODES = 16;

type UseCaseStarMapProps = {
  clientName: string;
  routeItems: RouteItem[];
  groupsById: Map<string, CreditCatalogGroup>;
  edges: GraphEdge[];
  statusByGroupId: Map<string, ClientUseCaseDisplayStatus>;
  candidateGroups: CreditCatalogGroup[];
  isSaving: boolean;
  selectedGroupId: string | null;
  onSelectGroup: (groupId: string) => void;
  onAdd: (groupId: string) => void;
  onRemove: (groupId: string) => void;
  onIconChange: (groupId: string, icon: string) => void;
};

export function UseCaseStarMap({
  clientName,
  routeItems,
  groupsById,
  edges,
  statusByGroupId,
  candidateGroups,
  isSaving,
  selectedGroupId,
  onSelectGroup,
  onAdd,
  onRemove,
  onIconChange,
}: UseCaseStarMapProps) {
  const [searchTerm, setSearchTerm] = useState("");

  const nodes = useMemo(
    () =>
      routeItems
        .map((item) => {
          const group = groupsById.get(item.groupId);
          if (!group) return null;
          return { item, group };
        })
        .filter((node): node is { item: RouteItem; group: CreditCatalogGroup } => Boolean(node)),
    [groupsById, routeItems],
  );

  const searchResults = useMemo(() => {
    const normalizedSearch = normalizeReference(searchTerm);
    if (!normalizedSearch) return [];
    return candidateGroups
      .filter(
        (group) =>
          normalizeReference(group.name).includes(normalizedSearch)
          || normalizeReference(group.use_case_code ?? "").includes(normalizedSearch),
      )
      .slice(0, 8);
  }, [candidateGroups, searchTerm]);

  const nodeIds = useMemo(() => new Set(nodes.map((node) => node.group.id)), [nodes]);
  const relationLines = useMemo(() => {
    const seen = new Set<string>();
    const pairs: { a: string; b: string }[] = [];
    edges.forEach((edge) => {
      if (!nodeIds.has(edge.sourceId) || !nodeIds.has(edge.targetId)) return;
      const key = [edge.sourceId, edge.targetId].sort().join(":");
      if (seen.has(key)) return;
      seen.add(key);
      pairs.push({ a: edge.sourceId, b: edge.targetId });
    });
    return pairs;
  }, [edges, nodeIds]);

  const cx = 400;
  const cy = 400;
  const n = nodes.length;
  const hubR = 74;
  const nodeR = n <= 6 ? 46 : n <= 10 ? 40 : 34;
  const radius = n <= 6 ? 230 : n <= 10 ? 270 : 310;

  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    nodes.forEach((node, index) => {
      const angle = ((-90 + (360 / Math.max(n, 1)) * index) * Math.PI) / 180;
      map.set(node.group.id, {
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
      });
    });
    return map;
  }, [n, nodes, radius]);

  return (
    <div className="mt-6 grid gap-5 lg:grid-cols-[340px_1fr]">
      <aside className="flex min-h-0 flex-col gap-5 overflow-y-auto rounded-[20px] border border-slate-200 bg-white p-5 shadow-[0_14px_42px_rgba(15,23,42,0.05)]">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#99acc2]">
            Agregar caso de uso
          </span>
          <div className="relative mt-1.5">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Buscar en la librería"
              className="h-10 pl-9"
              disabled={nodes.length >= MAX_MAP_NODES}
            />
          </div>
          {nodes.length >= MAX_MAP_NODES ? (
            <p className="mt-1.5 text-xs text-slate-400">Alcanzaste el máximo de {MAX_MAP_NODES} casos en el mapa.</p>
          ) : null}
          {searchTerm ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {searchResults.length === 0 ? (
                <p className="text-sm text-slate-400">Sin resultados.</p>
              ) : (
                searchResults.map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    disabled={isSaving || nodes.length >= MAX_MAP_NODES}
                    onClick={() => {
                      onAdd(group.id);
                      setSearchTerm("");
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:border-[var(--accent)] hover:bg-white disabled:cursor-wait disabled:opacity-60"
                  >
                    {group.use_case_code ? `${group.use_case_code} · ` : ""}
                    {group.name}
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>

        <div>
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#99acc2]">
            Casos en el mapa ({nodes.length})
          </span>
          <div className="mt-2 flex flex-col gap-2">
            {nodes.length === 0 ? (
              <p className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-400">
                Busca arriba y agrega los primeros casos de uso del mapa.
              </p>
            ) : (
              nodes.map(({ item, group }) => (
                <div
                  key={group.id}
                  className={cn(
                    "flex items-center gap-2 rounded-xl border p-2 transition",
                    selectedGroupId === group.id
                      ? "border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_6%,white)]"
                      : "border-slate-200 bg-slate-50/70",
                  )}
                >
                  <EmojiPicker
                    value={item.icon}
                    onChange={(icon) => onIconChange(group.id, icon)}
                    label={`Ícono para ${group.name}`}
                  />
                  <button
                    type="button"
                    onClick={() => onSelectGroup(group.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate text-xs font-black text-slate-800">{group.name}</p>
                    {group.use_case_code ? (
                      <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">
                        {group.use_case_code}
                      </p>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => onRemove(group.id)}
                    className="shrink-0 rounded-full p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label={`Quitar ${group.name} del mapa`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </aside>

      <main className="flex flex-col items-center gap-3 rounded-[20px] border border-slate-200 bg-white p-5 shadow-[0_14px_42px_rgba(15,23,42,0.05)]">
        {nodes.length === 0 ? (
          <div className="flex min-h-[420px] flex-col items-center justify-center px-6 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
              <MapIcon className="h-7 w-7" />
            </div>
            <h3 className="mt-4 font-bold text-slate-900">El mapa de {clientName} está vacío</h3>
            <p className="mt-1 max-w-md text-sm leading-6 text-slate-500">
              Busca casos de uso en el panel de la izquierda o desde la librería completa para empezar a armarlo.
            </p>
          </div>
        ) : (
          <svg
            viewBox="0 0 800 800"
            role="img"
            aria-label={`Mapa de casos de uso de ${clientName}`}
            className="w-full max-w-[640px]"
          >
            <defs>
              <filter id="star-node-shadow" x="-40%" y="-40%" width="180%" height="180%">
                <feDropShadow dx="0" dy="3" stdDeviation="5" floodColor="#0f172a" floodOpacity="0.16" />
              </filter>
            </defs>

            <g>
              {nodes.map(({ group }) => {
                const p = positions.get(group.id);
                if (!p) return null;
                return (
                  <line
                    key={group.id}
                    x1={cx}
                    y1={cy}
                    x2={p.x}
                    y2={p.y}
                    stroke="#cbd5e1"
                    strokeWidth={2.5}
                  />
                );
              })}
              {relationLines.map((pair) => {
                const pa = positions.get(pair.a);
                const pb = positions.get(pair.b);
                if (!pa || !pb) return null;
                return (
                  <line
                    key={`${pair.a}-${pair.b}`}
                    x1={pa.x}
                    y1={pa.y}
                    x2={pb.x}
                    y2={pb.y}
                    stroke="#a1a1aa"
                    strokeWidth={1.5}
                    strokeDasharray="7 6"
                  />
                );
              })}
            </g>

            <g>
              {nodes.map(({ item, group }) => {
                const p = positions.get(group.id);
                if (!p) return null;
                const status: ClientUseCaseDisplayStatus = statusByGroupId.get(group.id) ?? "untouched";
                const statusColors = CLIENT_USE_CASE_STATUS_COLORS[status];
                const selected = selectedGroupId === group.id;
                const labelLines = wrapStarLabel(group.name, 15);
                return (
                  <g
                    key={group.id}
                    transform={`translate(${p.x} ${p.y})`}
                    onClick={() => onSelectGroup(group.id)}
                    className="cursor-pointer outline-none"
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelectGroup(group.id);
                      }
                    }}
                    aria-label={`${group.name} (${status})`}
                  >
                    <circle
                      r={nodeR}
                      fill={statusColors.fill}
                      stroke={selected ? "var(--accent)" : "#e2e8f0"}
                      strokeWidth={selected ? 3.5 : 1.5}
                      filter="url(#star-node-shadow)"
                    />
                    <text textAnchor="middle" y={nodeR * 0.16} fontSize={nodeR * 0.72}>
                      {item.icon || DEFAULT_NODE_ICON}
                    </text>
                    {labelLines.map((line, index) => (
                      <text
                        key={`${line}-${index}`}
                        textAnchor="middle"
                        x="0"
                        y={nodeR + 18 + index * 14}
                        fontSize="11"
                        fontWeight="700"
                        fill="#334155"
                      >
                        {line}
                      </text>
                    ))}
                  </g>
                );
              })}
            </g>

            <g transform={`translate(${cx} ${cy})`}>
              <circle r={hubR} fill="var(--accent)" filter="url(#star-node-shadow)" />
              {wrapStarLabel(clientName, 13).map((line, index, arr) => (
                <text
                  key={`${line}-${index}`}
                  textAnchor="middle"
                  x="0"
                  y={8 + index * 18 - ((arr.length - 1) * 9)}
                  fontSize="15"
                  fontWeight="800"
                  fill="#ffffff"
                >
                  {line}
                </text>
              ))}
            </g>
          </svg>
        )}
        <p className="max-w-[52ch] text-center text-xs leading-5 text-slate-500">
          Línea continua: caso incluido en el mapa · línea punteada: relación real entre dos casos de uso del
          catálogo.
        </p>
      </main>
    </div>
  );
}
