"use client";

import { Map as MapIcon, Maximize2, Search, ZoomIn, ZoomOut, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

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

/** Deterministic per-id "randomness" so the star's irregularity stays stable across renders. */
function hashSeed(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function jitterFor(id: string, salt: string, spread: number) {
  const seed = hashSeed(`${id}:${salt}`);
  return ((seed % 1000) / 1000 - 0.5) * 2 * spread;
}

const ZOOM_MIN = 0.55;
const ZOOM_MAX = 2.4;

function clampZoom(value: number) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

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
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOffsets, setDragOffsets] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragStartRef = useRef<{ groupId: string; pointerX: number; pointerY: number; moved: boolean } | null>(
    null,
  );
  const panStartRef = useRef<{ pointerX: number; pointerY: number; panX: number; panY: number } | null>(null);
  const dragRafRef = useRef<number | null>(null);
  const pendingDragRef = useRef<{ groupId: string; x: number; y: number } | null>(null);
  const panRafRef = useRef<number | null>(null);
  const pendingPanRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      setZoom((current) => clampZoom(current - event.deltaY * 0.0016));
    }
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  useEffect(
    () => () => {
      if (dragRafRef.current !== null) cancelAnimationFrame(dragRafRef.current);
      if (panRafRef.current !== null) cancelAnimationFrame(panRafRef.current);
    },
    [],
  );

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

  const orderedNodes = useMemo(() => {
    if (!draggingId) return nodes;
    const dragged = nodes.filter((node) => node.group.id === draggingId);
    const rest = nodes.filter((node) => node.group.id !== draggingId);
    return [...rest, ...dragged];
  }, [draggingId, nodes]);

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
      const baseAngleDeg = -90 + (360 / Math.max(n, 1)) * index;
      const angle = ((baseAngleDeg + jitterFor(node.group.id, "angle", 12)) * Math.PI) / 180;
      const jitteredRadius = radius + jitterFor(node.group.id, "radius", 34);
      map.set(node.group.id, {
        x: cx + jitteredRadius * Math.cos(angle),
        y: cy + jitteredRadius * Math.sin(angle),
      });
    });
    return map;
  }, [n, nodes, radius]);

  function pointerToSvgPoint(clientX: number, clientY: number) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const viewSize = 800 / zoom;
    return {
      x: (clientX - rect.left) * (viewSize / rect.width),
      y: (clientY - rect.top) * (viewSize / rect.height),
    };
  }

  function handleNodePointerDown(groupId: string, event: ReactPointerEvent<SVGGElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointerToSvgPoint(event.clientX, event.clientY);
    dragStartRef.current = { groupId, pointerX: point.x, pointerY: point.y, moved: false };
    setDraggingId(groupId);
  }

  function handleNodePointerMove(groupId: string, event: ReactPointerEvent<SVGGElement>) {
    const start = dragStartRef.current;
    if (!start || start.groupId !== groupId) return;
    const point = pointerToSvgPoint(event.clientX, event.clientY);
    const dx = point.x - start.pointerX;
    const dy = point.y - start.pointerY;
    if (Math.hypot(dx, dy) > 3) start.moved = true;
    pendingDragRef.current = { groupId, x: dx, y: dy };
    if (dragRafRef.current === null) {
      dragRafRef.current = requestAnimationFrame(() => {
        dragRafRef.current = null;
        const pending = pendingDragRef.current;
        if (!pending) return;
        setDragOffsets((prev) => {
          const next = new Map(prev);
          next.set(pending.groupId, { x: pending.x, y: pending.y });
          return next;
        });
      });
    }
  }

  function handleNodePointerUp(groupId: string, event: ReactPointerEvent<SVGGElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (dragRafRef.current !== null) {
      cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }
    pendingDragRef.current = null;
    const wasClick = !dragStartRef.current?.moved;
    dragStartRef.current = null;
    setDraggingId(null);
    setDragOffsets((prev) => {
      const next = new Map(prev);
      next.delete(groupId);
      return next;
    });
    if (wasClick) onSelectGroup(groupId);
  }

  function handleCanvasPointerDown(event: ReactPointerEvent<SVGRectElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    panStartRef.current = { pointerX: event.clientX, pointerY: event.clientY, panX: pan.x, panY: pan.y };
    setIsPanning(true);
  }

  function handleCanvasPointerMove(event: ReactPointerEvent<SVGRectElement>) {
    if (!panStartRef.current) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const scale = 800 / zoom / rect.width;
    pendingPanRef.current = {
      x: panStartRef.current.panX + (event.clientX - panStartRef.current.pointerX) * scale,
      y: panStartRef.current.panY + (event.clientY - panStartRef.current.pointerY) * scale,
    };
    if (panRafRef.current === null) {
      panRafRef.current = requestAnimationFrame(() => {
        panRafRef.current = null;
        if (pendingPanRef.current) setPan(pendingPanRef.current);
      });
    }
  }

  function handleCanvasPointerUp(event: ReactPointerEvent<SVGRectElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (panRafRef.current !== null) {
      cancelAnimationFrame(panRafRef.current);
      panRafRef.current = null;
    }
    pendingPanRef.current = null;
    panStartRef.current = null;
    setIsPanning(false);
  }

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
          <div className="relative w-full overflow-hidden rounded-2xl">
            <div className="absolute right-2 top-2 z-10 flex gap-1 rounded-full border border-slate-200 bg-white/90 p-1 shadow-sm backdrop-blur">
              <button
                type="button"
                onClick={() => setZoom((current) => clampZoom(current - 0.2))}
                aria-label="Alejar"
                className="flex h-7 w-7 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setZoom(1);
                  setPan({ x: 0, y: 0 });
                }}
                aria-label="Restablecer zoom"
                className="flex h-7 w-7 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
              >
                <Maximize2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setZoom((current) => clampZoom(current + 0.2))}
                aria-label="Acercar"
                className="flex h-7 w-7 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
            </div>
            <svg
              ref={svgRef}
              viewBox={(() => {
                const size = 800 / zoom;
                const offset = (800 - size) / 2;
                return `${offset - pan.x} ${offset - pan.y} ${size} ${size}`;
              })()}
              role="img"
              aria-label={`Mapa de casos de uso de ${clientName}`}
              className="w-full touch-none"
            >
            <defs>
              <filter id="star-node-shadow" x="-40%" y="-40%" width="180%" height="180%">
                <feDropShadow dx="0" dy="3" stdDeviation="5" floodColor="#0f172a" floodOpacity="0.16" />
              </filter>
            </defs>

            <rect
              x={0}
              y={0}
              width={800}
              height={800}
              fill="transparent"
              onPointerDown={handleCanvasPointerDown}
              onPointerMove={handleCanvasPointerMove}
              onPointerUp={handleCanvasPointerUp}
              onPointerCancel={handleCanvasPointerUp}
              className={isPanning ? "cursor-grabbing" : "cursor-grab"}
            />
            <g>
              {nodes.map(({ group }) => {
                const p = positions.get(group.id);
                if (!p) return null;
                const offset = dragOffsets.get(group.id);
                const x2 = p.x + (offset?.x ?? 0);
                const y2 = p.y + (offset?.y ?? 0);
                return (
                  <line
                    key={group.id}
                    x1={cx}
                    y1={cy}
                    x2={x2}
                    y2={y2}
                    stroke="#cbd5e1"
                    strokeWidth={2.5}
                    style={
                      draggingId === group.id
                        ? undefined
                        : { transition: "x2 0.5s cubic-bezier(0.34, 1.56, 0.64, 1), y2 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)" }
                    }
                  />
                );
              })}
              {relationLines.map((pair) => {
                const pa = positions.get(pair.a);
                const pb = positions.get(pair.b);
                if (!pa || !pb) return null;
                const offsetA = dragOffsets.get(pair.a);
                const offsetB = dragOffsets.get(pair.b);
                return (
                  <line
                    key={`${pair.a}-${pair.b}`}
                    x1={pa.x + (offsetA?.x ?? 0)}
                    y1={pa.y + (offsetA?.y ?? 0)}
                    x2={pb.x + (offsetB?.x ?? 0)}
                    y2={pb.y + (offsetB?.y ?? 0)}
                    stroke="#a1a1aa"
                    strokeWidth={1.5}
                    strokeDasharray="7 6"
                    style={
                      draggingId === pair.a || draggingId === pair.b
                        ? undefined
                        : { transition: "x1 0.5s cubic-bezier(0.34, 1.56, 0.64, 1), y1 0.5s cubic-bezier(0.34, 1.56, 0.64, 1), x2 0.5s cubic-bezier(0.34, 1.56, 0.64, 1), y2 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)" }
                    }
                  />
                );
              })}
            </g>

            <g>
              {orderedNodes.map(({ item, group }) => {
                const p = positions.get(group.id);
                if (!p) return null;
                const offset = dragOffsets.get(group.id);
                const x = p.x + (offset?.x ?? 0);
                const y = p.y + (offset?.y ?? 0);
                const status: ClientUseCaseDisplayStatus = statusByGroupId.get(group.id) ?? "untouched";
                const statusColors = CLIENT_USE_CASE_STATUS_COLORS[status];
                const selected = selectedGroupId === group.id;
                const labelLines = wrapStarLabel(group.name, 15);
                return (
                  <g
                    key={group.id}
                    transform={`translate(${x} ${y})`}
                    style={
                      draggingId === group.id
                        ? undefined
                        : { transition: "transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)" }
                    }
                    onPointerDown={(event) => handleNodePointerDown(group.id, event)}
                    onPointerMove={(event) => handleNodePointerMove(group.id, event)}
                    onPointerUp={(event) => handleNodePointerUp(group.id, event)}
                    onPointerCancel={(event) => handleNodePointerUp(group.id, event)}
                    className={cn("outline-none", draggingId === group.id ? "cursor-grabbing" : "cursor-grab")}
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
          </div>
        )}
        <p className="max-w-[52ch] text-center text-xs leading-5 text-slate-500">
          Línea continua: caso incluido en el mapa · línea punteada: relación real entre dos casos de uso del
          catálogo.
        </p>
      </main>
    </div>
  );
}
