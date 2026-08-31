"use client";

import { ArrowLeft, Check, Layers3, Search, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import {
  CLIENT_USE_CASE_STATUS_COLORS,
  type ClientUseCaseDisplayStatus,
} from "@/lib/client-use-case-status";
import type { CreditCatalogGroup, CreditCatalogGroupCluster } from "@/lib/onboarding";
import {
  normalizeReference,
  UNASSIGNED_COLOR,
  wrapStarLabel,
  WITHOUT_CLUSTER,
  type GraphEdge,
} from "@/lib/use-case-graph";

type UseCaseLibraryProps = {
  groups: CreditCatalogGroup[];
  sortedClusters: CreditCatalogGroupCluster[];
  clusterColorById: Map<string, string>;
  clusterIdsByGroupId: Map<string, string[]>;
  linkedGroupIds: Set<string>;
  statusByGroupId: Map<string, ClientUseCaseDisplayStatus>;
  mappedGroupIds: Set<string>;
  edges: GraphEdge[];
  selectedGroupId: string | null;
  onSelectGroup: (groupId: string) => void;
};

type RingNode = {
  id: string;
  label: string;
  caption: string;
  fill: string;
  textColor: string;
  isMapped: boolean;
  onClick: () => void;
};

export function UseCaseLibrary({
  groups,
  sortedClusters,
  clusterColorById,
  clusterIdsByGroupId,
  linkedGroupIds,
  statusByGroupId,
  mappedGroupIds,
  edges,
  selectedGroupId,
  onSelectGroup,
}: UseCaseLibraryProps) {
  const [clusterId, setClusterId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const groupsByClusterId = useMemo(() => {
    const map = new Map<string, CreditCatalogGroup[]>();
    groups.forEach((group) => {
      (clusterIdsByGroupId.get(group.id) ?? []).forEach((id) => {
        const current = map.get(id) ?? [];
        current.push(group);
        map.set(id, current);
      });
    });
    return map;
  }, [clusterIdsByGroupId, groups]);
  const groupsWithoutCluster = useMemo(
    () => groups.filter((group) => !linkedGroupIds.has(group.id)),
    [groups, linkedGroupIds],
  );

  const normalizedSearch = normalizeReference(searchTerm);
  const isSearching = Boolean(normalizedSearch);

  const searchMatches = useMemo(() => {
    if (!isSearching) return [];
    return groups
      .filter(
        (group) =>
          normalizeReference(group.name).includes(normalizedSearch)
          || normalizeReference(group.use_case_code ?? "").includes(normalizedSearch),
      )
      .slice(0, 60);
  }, [groups, isSearching, normalizedSearch]);

  const activeCluster = clusterId && clusterId !== WITHOUT_CLUSTER
    ? sortedClusters.find((cluster) => cluster.id === clusterId) ?? null
    : null;

  const showingGroups = isSearching || Boolean(clusterId);
  const currentGroups = useMemo(
    () =>
      isSearching
        ? searchMatches
        : clusterId === WITHOUT_CLUSTER
          ? groupsWithoutCluster
          : clusterId
            ? groupsByClusterId.get(clusterId) ?? []
            : [],
    [clusterId, groupsByClusterId, groupsWithoutCluster, isSearching, searchMatches],
  );

  function goBack() {
    setClusterId(null);
    setSearchTerm("");
  }

  const nodes: RingNode[] = useMemo(() => {
    if (showingGroups) {
      return currentGroups.map((group) => {
        const status: ClientUseCaseDisplayStatus = statusByGroupId.get(group.id) ?? "untouched";
        const statusColors = CLIENT_USE_CASE_STATUS_COLORS[status];
        return {
          id: group.id,
          label: group.name,
          caption: group.use_case_code?.trim() || "Sin código",
          fill: statusColors.fill,
          textColor: statusColors.text,
          isMapped: mappedGroupIds.has(group.id),
          onClick: () => onSelectGroup(group.id),
        };
      });
    }

    const clusterNodes: RingNode[] = sortedClusters.map((cluster) => ({
      id: cluster.id,
      label: cluster.label,
      caption: `${(groupsByClusterId.get(cluster.id) ?? []).length} casos`,
      fill: clusterColorById.get(cluster.id) ?? UNASSIGNED_COLOR,
      textColor: "#ffffff",
      isMapped: false,
      onClick: () => setClusterId(cluster.id),
    }));

    if (groupsWithoutCluster.length) {
      clusterNodes.push({
        id: WITHOUT_CLUSTER,
        label: "Sin clúster",
        caption: `${groupsWithoutCluster.length} casos`,
        fill: UNASSIGNED_COLOR,
        textColor: "#ffffff",
        isMapped: false,
        onClick: () => setClusterId(WITHOUT_CLUSTER),
      });
    }

    return clusterNodes;
  }, [
    clusterColorById,
    currentGroups,
    groupsByClusterId,
    groupsWithoutCluster,
    mappedGroupIds,
    onSelectGroup,
    showingGroups,
    sortedClusters,
    statusByGroupId,
  ]);

  const hubLabel = isSearching
    ? `Resultados (${currentGroups.length})`
    : clusterId === WITHOUT_CLUSTER
      ? "Sin clúster"
      : activeCluster?.label ?? "Librería completa";

  const n = nodes.length;
  const nodeR = n <= 8 ? 44 : n <= 16 ? 36 : n <= 28 ? 30 : 24;
  const radius = n <= 8 ? 230 : n <= 16 ? 280 : n <= 28 ? 340 : 400;
  const hubR = 68;
  const size = Math.max(800, radius * 2 + nodeR * 2 + 180);
  const cx = size / 2;
  const cy = size / 2;

  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    nodes.forEach((node, index) => {
      const angle = ((-90 + (360 / Math.max(n, 1)) * index) * Math.PI) / 180;
      map.set(node.id, {
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
      });
    });
    return map;
  }, [cx, cy, n, nodes, radius]);

  const nodeIds = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);
  const relationLines = useMemo(() => {
    if (!showingGroups) return [];
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
  }, [edges, nodeIds, showingGroups]);

  return (
    <section className="mt-6 overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-[0_14px_42px_rgba(15,23,42,0.05)]">
      <div className="border-b border-slate-100 px-4 py-4 sm:px-5">
        <div className="flex items-center gap-2">
          <Layers3 className="h-4 w-4 text-[var(--accent)]" />
          <h3 className="text-sm font-black uppercase tracking-[0.1em] text-slate-700">Librería completa</h3>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {clusterId || isSearching
            ? "Haz clic en un caso de uso para ver su detalle y agregarlo al mapa."
            : "Haz clic en un clúster para ver sus casos de uso, o busca directamente."}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {clusterId && !isSearching ? (
            <button
              type="button"
              onClick={goBack}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600 transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Todos los clústeres
            </button>
          ) : null}
          <div className="relative min-w-[220px] flex-1 sm:flex-none">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Buscar caso o código en toda la librería"
              className="h-10 pl-9"
            />
            {searchTerm ? (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                aria-label="Limpiar búsqueda"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex flex-col items-center gap-3 p-4 sm:p-5">
        {nodes.length === 0 ? (
          <p className="py-10 text-sm text-slate-400">No encontramos casos de uso con estos filtros.</p>
        ) : (
          <div className="w-full overflow-auto">
            <svg
              viewBox={`0 0 ${size} ${size}`}
              role="img"
              aria-label={hubLabel}
              className="mx-auto w-full max-w-[720px]"
            >
              <defs>
                <filter id="library-node-shadow" x="-40%" y="-40%" width="180%" height="180%">
                  <feDropShadow dx="0" dy="3" stdDeviation="5" floodColor="#0f172a" floodOpacity="0.16" />
                </filter>
              </defs>

              <g>
                {nodes.map((node) => {
                  const p = positions.get(node.id);
                  if (!p) return null;
                  return <line key={node.id} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="#e2e8f0" strokeWidth={2} />;
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
                {nodes.map((node) => {
                  const p = positions.get(node.id);
                  if (!p) return null;
                  const selected = selectedGroupId === node.id;
                  const labelLines = wrapStarLabel(node.label, n > 20 ? 13 : 16);
                  return (
                    <g
                      key={node.id}
                      transform={`translate(${p.x} ${p.y})`}
                      onClick={node.onClick}
                      className="cursor-pointer outline-none"
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          node.onClick();
                        }
                      }}
                      aria-label={node.label}
                    >
                      <circle
                        r={nodeR}
                        fill={node.fill}
                        stroke={selected ? "var(--accent)" : "#ffffff"}
                        strokeWidth={selected ? 3.5 : 2}
                        filter="url(#library-node-shadow)"
                      />
                      {node.isMapped ? (
                        <circle cx={nodeR * 0.66} cy={-nodeR * 0.66} r="8" fill="#0f172a" stroke="#ffffff" strokeWidth="1.5" />
                      ) : null}
                      {node.isMapped ? (
                        <text x={nodeR * 0.66} y={-nodeR * 0.66 + 3} textAnchor="middle" fontSize="9" fill="#ffffff">
                          ✓
                        </text>
                      ) : null}
                      <text
                        textAnchor="middle"
                        y={-((labelLines.length - 1) * 6.5) + nodeR * 0.05}
                        fontSize={nodeR * 0.24}
                        fontWeight="800"
                        fill={node.textColor}
                      >
                        {labelLines.map((line, index) => (
                          <tspan key={`${line}-${index}`} x="0" dy={index === 0 ? 0 : 13}>
                            {line}
                          </tspan>
                        ))}
                      </text>
                      <text
                        textAnchor="middle"
                        y={nodeR + 15}
                        fontSize="9.5"
                        fontWeight="700"
                        fill="#94a3b8"
                      >
                        {node.caption}
                      </text>
                    </g>
                  );
                })}
              </g>

              <g transform={`translate(${cx} ${cy})`}>
                <circle r={hubR} fill="var(--accent)" filter="url(#library-node-shadow)" />
                {wrapStarLabel(hubLabel, 13).map((line, index, arr) => (
                  <text
                    key={`${line}-${index}`}
                    textAnchor="middle"
                    x="0"
                    y={8 + index * 18 - (arr.length - 1) * 9}
                    fontSize="14"
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
        <p className="flex items-center gap-1.5 text-center text-xs leading-5 text-slate-500">
          <Check className="h-3.5 w-3.5 text-slate-700" /> = ya está en el mapa del cliente · línea punteada =
          relación real entre casos de uso.
        </p>
      </div>
    </section>
  );
}
