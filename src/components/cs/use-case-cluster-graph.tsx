"use client";

import {
  AlertTriangle,
  ArrowRight,
  Check,
  Focus,
  Layers3,
  Minus,
  Network,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type {
  CreditCatalogGroup,
  CreditCatalogGroupCluster,
  CreditCatalogGroupClusterLink,
  CreditCatalogUseCaseCategory,
} from "@/lib/onboarding";
import { cn, safeParseNumber } from "@/lib/utils";

type UseCaseClusterGraphProps = {
  groups: CreditCatalogGroup[];
  clusters: CreditCatalogGroupCluster[];
  clusterLinks: CreditCatalogGroupClusterLink[];
  categories: CreditCatalogUseCaseCategory[];
};

type RelationKind = "logical" | "previous" | "subsequent";

type GraphEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  kind: RelationKind;
};

type UnresolvedReference = {
  groupId: string;
  value: string;
  kind: RelationKind;
};

type PositionedNode = {
  group: CreditCatalogGroup;
  x: number;
  y: number;
};

const ALL_CLUSTERS = "__all__";
const WITHOUT_CLUSTER = "__without_cluster__";
const NODE_RADIUS = 25;
const UNASSIGNED_COLOR = "#64748b";
const CLUSTER_COLORS = [
  "#2563eb",
  "#db2777",
  "#7c3aed",
  "#059669",
  "#ea580c",
  "#0891b2",
  "#ca8a04",
  "#4f46e5",
  "#dc2626",
  "#0d9488",
  "#9333ea",
  "#65a30d",
] as const;

const relationConfig: Record<
  RelationKind,
  { label: string; shortLabel: string; color: string; dash?: string }
> = {
  logical: {
    label: "Siguiente caso",
    shortLabel: "Siguiente",
    color: "#00a894",
  },
  previous: {
    label: "Caso previo",
    shortLabel: "Previo",
    color: "#64748b",
    dash: "7 6",
  },
  subsequent: {
    label: "Caso posterior",
    shortLabel: "Posterior",
    color: "#8b5cf6",
    dash: "3 6",
  },
};

function normalizeReference(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/^[\s_-]*cu[\s:_-]*/i, "")
    .replace(/\s+/g, " ");
}

function splitReferences(value: string | null) {
  if (!value?.trim()) return [];

  return [...new Set(value.split(/[;,\n]+/).map((item) => item.trim()).filter(Boolean))];
}

function truncate(value: string, length: number) {
  return value.length > length ? `${value.slice(0, length - 1).trim()}…` : value;
}

function wrapNodeTitle(value: string) {
  const words = value.trim().split(/\s+/);
  const lines: string[] = [];

  for (const word of words) {
    const current = lines.at(-1);
    if (!current || (current.length + word.length + 1 > 29 && lines.length < 2)) {
      lines.push(word);
    } else {
      lines[lines.length - 1] = `${current} ${word}`;
    }
  }

  if (lines.length > 2) {
    lines[1] = truncate(lines.slice(1).join(" "), 29);
    return lines.slice(0, 2);
  }

  if (lines[1]?.length > 29) lines[1] = truncate(lines[1], 29);
  return lines;
}

function compareCasesForSequence(left: CreditCatalogGroup, right: CreditCatalogGroup) {
  const leftNumber = Number(left.use_case_code?.match(/\d+/)?.[0]);
  const rightNumber = Number(right.use_case_code?.match(/\d+/)?.[0]);

  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
    return leftNumber - rightNumber;
  }

  return safeParseNumber(left.sort_order) - safeParseNumber(right.sort_order)
    || left.name.localeCompare(right.name, "es");
}

function roundGraphCoordinate(value: number) {
  return Math.round(value * 100) / 100;
}

function getArrowPath(source: PositionedNode, target: PositionedNode) {
  const deltaX = target.x - source.x;
  const deltaY = target.y - source.y;
  const distance = Math.max(1, Math.hypot(deltaX, deltaY));
  const unitX = deltaX / distance;
  const unitY = deltaY / distance;
  const startX = source.x + unitX * (NODE_RADIUS + 2);
  const startY = source.y + unitY * (NODE_RADIUS + 2);
  const endX = target.x - unitX * (NODE_RADIUS + 8);
  const endY = target.y - unitY * (NODE_RADIUS + 8);
  const curve = Math.min(34, distance * 0.12);
  const controlX = (startX + endX) / 2 - unitY * curve;
  const controlY = (startY + endY) / 2 + unitX * curve;

  return `M ${startX} ${startY} Q ${controlX} ${controlY}, ${endX} ${endY}`;
}

function layoutGraph(
  groups: CreditCatalogGroup[],
  edges: GraphEdge[],
  primaryClusterByGroupId: Map<string, string>,
  groupByClusters: boolean,
) {
  const groupIds = new Set(groups.map((group) => group.id));
  const graphEdges = edges.filter(
    (edge) => groupIds.has(edge.sourceId) && groupIds.has(edge.targetId) && edge.sourceId !== edge.targetId,
  );
  const sortedGroups = [...groups].sort(
    (left, right) =>
      safeParseNumber(left.sort_order) - safeParseNumber(right.sort_order)
      || left.name.localeCompare(right.name, "es"),
  );
  const width = Math.max(1440, Math.min(2200, 1040 + Math.sqrt(Math.max(1, groups.length)) * 115));
  const height = Math.max(780, Math.min(1400, 610 + Math.sqrt(Math.max(1, groups.length)) * 88));
  const clusterKeys = [...new Set(sortedGroups.map((group) => primaryClusterByGroupId.get(group.id) ?? WITHOUT_CLUSTER))];
  const clusterCenters = new Map<string, { x: number; y: number }>();
  const centerX = width / 2;
  const centerY = height / 2;

  clusterKeys.forEach((clusterId, index) => {
    const angle = clusterKeys.length === 1 ? 0 : (Math.PI * 2 * index) / clusterKeys.length - Math.PI / 2;
    const spreadX = groupByClusters ? Math.min(width * 0.34, 150 + clusterKeys.length * 34) : 0;
    const spreadY = groupByClusters ? Math.min(height * 0.3, 110 + clusterKeys.length * 25) : 0;
    clusterCenters.set(clusterId, {
      x: centerX + Math.cos(angle) * spreadX,
      y: centerY + Math.sin(angle) * spreadY,
    });
  });

  const clusterOffsets = new Map<string, number>();
  const simulationNodes = sortedGroups.map((group, index) => {
    const clusterId = primaryClusterByGroupId.get(group.id) ?? WITHOUT_CLUSTER;
    const clusterIndex = clusterOffsets.get(clusterId) ?? 0;
    clusterOffsets.set(clusterId, clusterIndex + 1);
    const center = clusterCenters.get(clusterId) ?? { x: centerX, y: centerY };
    const angle = clusterIndex * 2.3999632297 + index * 0.09;
    const radius = 76 + Math.sqrt(clusterIndex) * 68;
    return {
      group,
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
      velocityX: 0,
      velocityY: 0,
    };
  });
  const simulationById = new Map(simulationNodes.map((node) => [node.group.id, node]));

  for (let iteration = 0; iteration < 150; iteration += 1) {
    for (let leftIndex = 0; leftIndex < simulationNodes.length; leftIndex += 1) {
      const left = simulationNodes[leftIndex];
      for (let rightIndex = leftIndex + 1; rightIndex < simulationNodes.length; rightIndex += 1) {
        const right = simulationNodes[rightIndex];
        const deltaX = right.x - left.x || 0.1;
        const deltaY = right.y - left.y || 0.1;
        const distance = Math.max(1, Math.hypot(deltaX, deltaY));
        if (distance > 188) continue;
        const force = (188 - distance) * 0.009;
        const forceX = (deltaX / distance) * force;
        const forceY = (deltaY / distance) * force;
        left.velocityX -= forceX;
        left.velocityY -= forceY;
        right.velocityX += forceX;
        right.velocityY += forceY;
      }
    }

    graphEdges.forEach((edge) => {
      const source = simulationById.get(edge.sourceId);
      const target = simulationById.get(edge.targetId);
      if (!source || !target) return;
      const deltaX = target.x - source.x;
      const deltaY = target.y - source.y;
      const distance = Math.max(1, Math.hypot(deltaX, deltaY));
      const force = (distance - 218) * 0.0038;
      const forceX = (deltaX / distance) * force;
      const forceY = (deltaY / distance) * force;
      source.velocityX += forceX;
      source.velocityY += forceY;
      target.velocityX -= forceX;
      target.velocityY -= forceY;
    });

    simulationNodes.forEach((node) => {
      const clusterId = primaryClusterByGroupId.get(node.group.id) ?? WITHOUT_CLUSTER;
      const center = clusterCenters.get(clusterId) ?? { x: centerX, y: centerY };
      node.velocityX += (center.x - node.x) * (groupByClusters ? 0.0012 : 0.00055);
      node.velocityY += (center.y - node.y) * (groupByClusters ? 0.0012 : 0.00055);
      node.velocityX *= 0.84;
      node.velocityY *= 0.84;
      node.x = Math.max(80, Math.min(width - 220, node.x + node.velocityX));
      node.y = Math.max(75, Math.min(height - 75, node.y + node.velocityY));
    });
  }

  // Server and browser floating-point calculations can differ by tiny fractions.
  // Quantizing prevents React hydration mismatches in SVG transform attributes.
  const positionedNodes: PositionedNode[] = simulationNodes.map(({ group, x, y }) => ({
    group,
    x: roundGraphCoordinate(x),
    y: roundGraphCoordinate(y),
  }));

  return {
    nodes: positionedNodes,
    edges: graphEdges,
    width: Math.round(width),
    height: Math.round(height),
  };
}

export function UseCaseClusterGraph({
  groups,
  clusters,
  clusterLinks,
  categories,
}: UseCaseClusterGraphProps) {
  const sortedClusters = useMemo(
    () =>
      [...clusters].sort(
        (left, right) =>
          safeParseNumber(left.sort_order) - safeParseNumber(right.sort_order)
          || left.label.localeCompare(right.label, "es"),
      ),
    [clusters],
  );
  const linksByCluster = useMemo(() => {
    const map = new Map<string, Set<string>>();
    clusterLinks.forEach((link) => {
      const current = map.get(link.cluster_id) ?? new Set<string>();
      current.add(link.group_id);
      map.set(link.cluster_id, current);
    });
    return map;
  }, [clusterLinks]);
  const linkedGroupIds = useMemo(
    () => new Set(clusterLinks.map((link) => link.group_id)),
    [clusterLinks],
  );
  const [selectedClusterId, setSelectedClusterId] = useState(ALL_CLUSTERS);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [hoveredGroupId, setHoveredGroupId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [zoom, setZoom] = useState(1);
  const [visibleRelations, setVisibleRelations] = useState<Record<RelationKind, boolean>>({
    logical: true,
    previous: false,
    subsequent: false,
  });

  const clusterColorById = useMemo(
    () => new Map(sortedClusters.map((cluster, index) => [cluster.id, CLUSTER_COLORS[index % CLUSTER_COLORS.length]])),
    [sortedClusters],
  );
  const primaryClusterByGroupId = useMemo(() => {
    const clusterOrderById = new Map(sortedClusters.map((cluster, index) => [cluster.id, index]));
    const orderedLinks = [...clusterLinks].sort(
      (left, right) =>
        safeParseNumber(left.sort_order) - safeParseNumber(right.sort_order)
        || (clusterOrderById.get(left.cluster_id) ?? Number.MAX_SAFE_INTEGER)
          - (clusterOrderById.get(right.cluster_id) ?? Number.MAX_SAFE_INTEGER),
    );
    const map = new Map<string, string>();
    orderedLinks.forEach((link) => {
      if (!map.has(link.group_id)) map.set(link.group_id, link.cluster_id);
    });
    return map;
  }, [clusterLinks, sortedClusters]);
  const clusterIdsByGroupId = useMemo(() => {
    const map = new Map<string, string[]>();
    clusterLinks.forEach((link) => {
      const current = map.get(link.group_id) ?? [];
      if (!current.includes(link.cluster_id)) current.push(link.cluster_id);
      map.set(link.group_id, current);
    });
    return map;
  }, [clusterLinks]);
  const categoriesById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );
  const groupsById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);
  const aliases = useMemo(() => {
    const map = new Map<string, string>();
    groups.forEach((group) => {
      const code = normalizeReference(group.use_case_code ?? "");
      const name = normalizeReference(group.name);
      if (code) map.set(code, group.id);
      if (name) map.set(name, group.id);
    });
    return map;
  }, [groups]);
  const { edges, unresolvedReferences } = useMemo(() => {
    const resolvedEdges: GraphEdge[] = [];
    const unresolved: UnresolvedReference[] = [];
    const edgeKeys = new Set<string>();

    function addReferences(
      group: CreditCatalogGroup,
      value: string | null,
      kind: RelationKind,
      direction: "outgoing" | "incoming",
    ) {
      splitReferences(value).forEach((reference) => {
        const relatedId = aliases.get(normalizeReference(reference));
        if (!relatedId) {
          unresolved.push({ groupId: group.id, value: reference, kind });
          return;
        }

        const sourceId = direction === "outgoing" ? group.id : relatedId;
        const targetId = direction === "outgoing" ? relatedId : group.id;
        if (sourceId === targetId) return;
        const key = `${sourceId}:${targetId}:${kind}`;
        if (edgeKeys.has(key)) return;
        edgeKeys.add(key);
        resolvedEdges.push({ id: key, sourceId, targetId, kind });
      });
    }

    groups.forEach((group) => {
      addReferences(group, group.next_logical_use_cases, "logical", "outgoing");
      addReferences(group, group.previous_use_cases, "previous", "incoming");
      addReferences(group, group.subsequent_use_cases, "subsequent", "outgoing");
    });

    return { edges: resolvedEdges, unresolvedReferences: unresolved };
  }, [aliases, groups]);

  const clusterGroupIds = useMemo(() => {
    if (selectedClusterId === ALL_CLUSTERS) return new Set(groups.map((group) => group.id));
    if (selectedClusterId === WITHOUT_CLUSTER) {
      return new Set(groups.filter((group) => !linkedGroupIds.has(group.id)).map((group) => group.id));
    }
    return linksByCluster.get(selectedClusterId) ?? new Set<string>();
  }, [groups, linkedGroupIds, linksByCluster, selectedClusterId]);

  const visibleGroups = useMemo(
    () => groups.filter((group) => clusterGroupIds.has(group.id) && group.is_active),
    [clusterGroupIds, groups],
  );
  const visibleGroupIds = useMemo(
    () => new Set(visibleGroups.map((group) => group.id)),
    [visibleGroups],
  );
  const filteredEdges = useMemo(
    () =>
      edges.filter(
        (edge) =>
          visibleRelations[edge.kind]
          && visibleGroupIds.has(edge.sourceId)
          && visibleGroupIds.has(edge.targetId),
      ),
    [edges, visibleGroupIds, visibleRelations],
  );
  const inferredEdges = useMemo(() => {
    if (!visibleRelations.logical || selectedClusterId === WITHOUT_CLUSTER) return [];

    const clusterIds = selectedClusterId === ALL_CLUSTERS
      ? sortedClusters.map((cluster) => cluster.id)
      : [selectedClusterId];
    const existingEdgeKeys = new Set(
      filteredEdges.map((edge) => `${edge.sourceId}:${edge.targetId}:${edge.kind}`),
    );
    const inferred: GraphEdge[] = [];

    clusterIds.forEach((clusterId) => {
      const orderedGroups = [...(linksByCluster.get(clusterId) ?? new Set<string>())]
        .filter((groupId) => visibleGroupIds.has(groupId))
        .map((groupId) => groupsById.get(groupId))
        .filter((group): group is CreditCatalogGroup => Boolean(group))
        .sort(compareCasesForSequence);
      const explicitOutgoingIds = new Set(
        filteredEdges
          .filter(
            (edge) =>
              edge.kind === "logical"
              && orderedGroups.some((group) => group.id === edge.sourceId)
              && orderedGroups.some((group) => group.id === edge.targetId),
          )
          .map((edge) => edge.sourceId),
      );

      for (let index = 0; index < orderedGroups.length - 1; index += 1) {
        const source = orderedGroups[index];
        const target = orderedGroups[index + 1];
        if (explicitOutgoingIds.has(source.id)) continue;
        const key = `${source.id}:${target.id}:logical`;
        if (existingEdgeKeys.has(key)) continue;
        existingEdgeKeys.add(key);
        inferred.push({
          id: `inferred:${clusterId}:${source.id}:${target.id}`,
          sourceId: source.id,
          targetId: target.id,
          kind: "logical",
        });
      }
    });

    return inferred;
  }, [filteredEdges, groupsById, linksByCluster, selectedClusterId, sortedClusters, visibleGroupIds, visibleRelations.logical]);
  const effectiveEdges = useMemo(
    () => [...filteredEdges, ...inferredEdges],
    [filteredEdges, inferredEdges],
  );
  const graph = useMemo(
    () => layoutGraph(
      visibleGroups,
      effectiveEdges,
      primaryClusterByGroupId,
      selectedClusterId === ALL_CLUSTERS,
    ),
    [effectiveEdges, primaryClusterByGroupId, selectedClusterId, visibleGroups],
  );
  const positionedById = useMemo(
    () => new Map(graph.nodes.map((node) => [node.group.id, node])),
    [graph.nodes],
  );
  const normalizedSearch = normalizeReference(searchQuery);
  const selectedGroup = selectedGroupId ? groupsById.get(selectedGroupId) ?? null : null;
  const selectedCluster = sortedClusters.find((cluster) => cluster.id === selectedClusterId) ?? null;
  const clusterTitle = selectedClusterId === ALL_CLUSTERS
    ? "Vista general"
    : selectedClusterId === WITHOUT_CLUSTER
      ? "Sin clúster"
      : selectedCluster?.label ?? "Clúster";
  const visibleUnresolved = unresolvedReferences.filter((reference) => visibleGroupIds.has(reference.groupId));
  const externalConnections = edges.filter(
    (edge) => visibleGroupIds.has(edge.sourceId) !== visibleGroupIds.has(edge.targetId),
  ).length;
  const selectedRelations = selectedGroup
    ? effectiveEdges.filter((edge) => edge.sourceId === selectedGroup.id || edge.targetId === selectedGroup.id)
    : [];

  function selectCluster(clusterId: string) {
    setSelectedClusterId(clusterId);
    setSelectedGroupId(null);
    setHoveredGroupId(null);
    setZoom(1);
  }

  function toggleRelation(kind: RelationKind) {
    setVisibleRelations((current) => ({ ...current, [kind]: !current[kind] }));
  }

  return (
    <div className="mx-auto w-full max-w-[1800px] px-4 py-8 sm:px-6 lg:px-8">
      <div className="rounded-[24px] border border-slate-200 bg-white px-6 py-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)] sm:px-8">
        <div className="inline-flex items-center gap-2 rounded-full bg-[color-mix(in_oklab,var(--accent)_11%,white)] px-3 py-1.5 text-xs font-bold uppercase tracking-[0.16em] text-[#0f766e]">
          <Network className="h-4 w-4" />
          Arquitectura de casos
        </div>
        <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
          Mapa de casos de uso
        </h1>
      </div>

      <main className="mt-6 min-w-0">
          <section className="overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-[0_14px_42px_rgba(15,23,42,0.05)]">
            <div className="border-b border-slate-200 px-4 py-4 sm:px-5">
              <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-center 2xl:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Layers3 className="h-4 w-4 shrink-0 text-[var(--accent)]" />
                    <h2 className="truncate text-lg font-black text-slate-950">{clusterTitle}</h2>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    El color identifica el clúster y la punta de la flecha indica cuál caso sigue.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <label className="min-w-[270px] flex-1 sm:flex-none">
                    <span className="sr-only">Seleccionar grafo</span>
                    <Select
                      value={selectedClusterId}
                      onChange={(event) => selectCluster(event.target.value)}
                      className="h-10 border-[color-mix(in_oklab,var(--accent)_30%,white)] bg-[color-mix(in_oklab,var(--accent)_4%,white)] font-semibold"
                      aria-label="Seleccionar grafo"
                    >
                      <option value={ALL_CLUSTERS}>Todos los clústeres · Vista general ({groups.length})</option>
                      {sortedClusters.map((cluster) => (
                        <option key={cluster.id} value={cluster.id}>
                          {cluster.label} ({linksByCluster.get(cluster.id)?.size ?? 0})
                        </option>
                      ))}
                      <option value={WITHOUT_CLUSTER}>Sin clúster ({groups.length - linkedGroupIds.size})</option>
                    </Select>
                  </label>
                  <div className="relative min-w-[210px] flex-1 sm:flex-none">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="Buscar caso o código"
                      className="h-10 pl-9"
                    />
                    {searchQuery ? (
                      <button
                        type="button"
                        onClick={() => setSearchQuery("")}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                        aria-label="Limpiar búsqueda"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(relationConfig) as RelationKind[]).map((kind) => {
                    const config = relationConfig[kind];
                    return (
                      <button
                        key={kind}
                        type="button"
                        onClick={() => toggleRelation(kind)}
                        className={cn(
                          "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition",
                          visibleRelations[kind]
                            ? "border-slate-200 bg-white text-slate-700 shadow-sm"
                            : "border-slate-200 bg-slate-50 text-slate-400",
                        )}
                        aria-pressed={visibleRelations[kind]}
                      >
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: visibleRelations[kind] ? config.color : "#cbd5e1" }}
                        />
                        {config.shortLabel}
                        {visibleRelations[kind] ? <Check className="h-3.5 w-3.5" /> : null}
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
                  <button
                    type="button"
                    onClick={() => setZoom((current) => Math.max(0.7, Number((current - 0.1).toFixed(1))))}
                    className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                    aria-label="Alejar"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="w-12 text-center text-xs font-bold text-slate-600">{Math.round(zoom * 100)}%</span>
                  <button
                    type="button"
                    onClick={() => setZoom((current) => Math.min(1.5, Number((current + 0.1).toFixed(1))))}
                    className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                    aria-label="Acercar"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoom(1)}
                    className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                    aria-label="Restablecer zoom"
                    title="Restablecer zoom"
                  >
                    <Focus className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 pt-3">
                <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">
                  Color por clúster
                </span>
                {(selectedClusterId === ALL_CLUSTERS
                  ? sortedClusters.filter((cluster) => (linksByCluster.get(cluster.id)?.size ?? 0) > 0)
                  : selectedCluster
                    ? [selectedCluster]
                    : []
                ).map((cluster) => (
                  <button
                    key={cluster.id}
                    type="button"
                    onClick={() => selectCluster(cluster.id)}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 transition hover:text-slate-950"
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full shadow-[0_0_0_3px_white] ring-1 ring-slate-200"
                      style={{ backgroundColor: clusterColorById.get(cluster.id) ?? UNASSIGNED_COLOR }}
                    />
                    {cluster.label}
                  </button>
                ))}
                {selectedClusterId === ALL_CLUSTERS && groups.length > linkedGroupIds.size ? (
                  <button
                    type="button"
                    onClick={() => selectCluster(WITHOUT_CLUSTER)}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 transition hover:text-slate-950"
                  >
                    <span className="h-2.5 w-2.5 rounded-full bg-slate-500" />
                    Sin clúster
                  </button>
                ) : null}
              </div>
            </div>

            {visibleGroups.length ? (
              <div
                className="h-[78vh] min-h-[720px] max-h-[980px] overflow-auto bg-[radial-gradient(circle_at_1px_1px,#dbe4ee_1px,transparent_0)] [background-size:22px_22px]"
                aria-label={`Grafo del clúster ${clusterTitle}`}
              >
                <svg
                  className="min-h-full min-w-full"
                  width={graph.width * zoom}
                  height={graph.height * zoom}
                  viewBox={`0 0 ${graph.width} ${graph.height}`}
                  role="img"
                  aria-label={`${visibleGroups.length} casos de uso y ${effectiveEdges.length} relaciones`}
                >
                  <defs>
                    {[...new Set([...clusterColorById.values(), UNASSIGNED_COLOR])].map((color) => (
                      <marker
                        key={color}
                        id={`cluster-arrow-${color.slice(1)}`}
                        viewBox="0 0 10 10"
                        refX="9"
                        refY="5"
                        markerWidth="7"
                        markerHeight="7"
                        orient="auto-start-reverse"
                      >
                        <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
                      </marker>
                    ))}
                    <filter id="node-shadow" x="-20%" y="-20%" width="140%" height="150%">
                      <feDropShadow dx="0" dy="5" stdDeviation="7" floodColor="#0f172a" floodOpacity="0.09" />
                    </filter>
                  </defs>

                  {graph.edges.map((edge) => {
                    const source = positionedById.get(edge.sourceId);
                    const target = positionedById.get(edge.targetId);
                    if (!source || !target) return null;
                    const config = relationConfig[edge.kind];
                    const sourceClusterId = primaryClusterByGroupId.get(edge.sourceId);
                    const edgeColor = sourceClusterId
                      ? clusterColorById.get(sourceClusterId) ?? UNASSIGNED_COLOR
                      : UNASSIGNED_COLOR;
                    const isMuted = selectedGroupId
                      ? edge.sourceId !== selectedGroupId && edge.targetId !== selectedGroupId
                      : false;
                    return (
                      <path
                        key={edge.id}
                        d={getArrowPath(source, target)}
                        fill="none"
                        stroke={edgeColor}
                        strokeWidth={isMuted ? 1.25 : edge.kind === "logical" ? 2.2 : 1.7}
                        strokeDasharray={config.dash}
                        markerEnd={`url(#cluster-arrow-${edgeColor.slice(1)})`}
                        opacity={isMuted ? 0.1 : edge.kind === "logical" ? 0.62 : 0.42}
                      />
                    );
                  })}

                  {graph.nodes.map((node) => {
                    const code = node.group.use_case_code?.trim() || "Sin código";
                    const matchesSearch = !normalizedSearch
                      || normalizeReference(node.group.name).includes(normalizedSearch)
                      || normalizeReference(code).includes(normalizedSearch);
                    const connectedToSelection = !selectedGroupId
                      || selectedGroupId === node.group.id
                      || selectedRelations.some(
                        (edge) =>
                          (edge.sourceId === selectedGroupId && edge.targetId === node.group.id)
                          || (edge.targetId === selectedGroupId && edge.sourceId === node.group.id),
                      );
                    const muted = !matchesSearch || !connectedToSelection;
                    const selected = selectedGroupId === node.group.id;
                    const clusterId = primaryClusterByGroupId.get(node.group.id);
                    const nodeClusterIds = clusterIdsByGroupId.get(node.group.id) ?? [];
                    const nodeColor = clusterId
                      ? clusterColorById.get(clusterId) ?? UNASSIGNED_COLOR
                      : UNASSIGNED_COLOR;
                    return (
                      <g
                        key={node.group.id}
                        transform={`translate(${node.x} ${node.y})`}
                        onClick={() => setSelectedGroupId(selected ? null : node.group.id)}
                        onMouseEnter={() => setHoveredGroupId(node.group.id)}
                        onMouseLeave={() => setHoveredGroupId(null)}
                        onFocus={() => setHoveredGroupId(node.group.id)}
                        onBlur={() => setHoveredGroupId(null)}
                        className="cursor-pointer outline-none"
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedGroupId(selected ? null : node.group.id);
                          }
                        }}
                        aria-label={`${code}: ${node.group.name}`}
                        opacity={muted ? 0.28 : 1}
                      >
                        <title>{`${code}: ${node.group.name}`}</title>
                        {selected ? (
                          <circle r="35" fill={nodeColor} opacity="0.16" />
                        ) : null}
                        <circle
                          r={NODE_RADIUS}
                          fill={nodeColor}
                          stroke={node.group.is_active ? "#ffffff" : "#fb7185"}
                          strokeWidth={selected ? 4 : node.group.is_active ? 2.5 : 4}
                          filter="url(#node-shadow)"
                        />
                        <text
                          x="0"
                          y="3.5"
                          textAnchor="middle"
                          fontSize={code.length > 8 ? "7.5" : "9.5"}
                          fontWeight="850"
                          fill="#ffffff"
                          letterSpacing="0.02em"
                        >
                          {truncate(code, 10)}
                        </text>
                        {!node.group.is_active ? (
                          <circle cx="18" cy="-18" r="5" fill="#fb7185" stroke="#ffffff" strokeWidth="2" />
                        ) : null}
                        {nodeClusterIds.length > 1 ? nodeClusterIds.slice(1, 5).map((secondaryClusterId, index) => (
                          <circle
                            key={secondaryClusterId}
                            cx={(index - Math.min(1.5, (nodeClusterIds.length - 2) / 2)) * 9}
                            cy="32"
                            r="3.5"
                            fill={clusterColorById.get(secondaryClusterId) ?? UNASSIGNED_COLOR}
                            stroke="#ffffff"
                            strokeWidth="1.5"
                          />
                        )) : null}
                      </g>
                    );
                  })}

                  {hoveredGroupId ? (() => {
                    const hoveredNode = positionedById.get(hoveredGroupId);
                    if (!hoveredNode) return null;
                    const tooltipLines = wrapNodeTitle(hoveredNode.group.name);
                    const tooltipWidth = Math.max(
                      176,
                      Math.min(260, Math.max(...tooltipLines.map((line) => line.length)) * 7 + 28),
                    );
                    const showOnLeft = hoveredNode.x + NODE_RADIUS + 16 + tooltipWidth > graph.width - 18;
                    const tooltipX = showOnLeft
                      ? hoveredNode.x - NODE_RADIUS - tooltipWidth - 16
                      : hoveredNode.x + NODE_RADIUS + 16;
                    const tooltipY = Math.max(18, Math.min(graph.height - 76, hoveredNode.y - 34));

                    return (
                      <g
                        transform={`translate(${tooltipX} ${tooltipY})`}
                        className="pointer-events-none"
                        role="tooltip"
                      >
                        <rect
                          width={tooltipWidth}
                          height={68}
                          rx="12"
                          fill="#0f172a"
                          opacity="0.96"
                          filter="url(#node-shadow)"
                        />
                        <text x="14" y="19" fontSize="9" fontWeight="800" fill="#94a3b8" letterSpacing="0.08em">
                          {hoveredNode.group.use_case_code?.trim() || "CASO DE USO"}
                        </text>
                        {tooltipLines.map((line, index) => (
                          <text key={`${line}-${index}`} x="14" y={40 + index * 16} fontSize="11.5" fontWeight="700" fill="#ffffff">
                            {line}
                          </text>
                        ))}
                      </g>
                    );
                  })() : null}
                </svg>
              </div>
            ) : (
              <div className="flex min-h-[500px] flex-col items-center justify-center px-6 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                  <Network className="h-7 w-7" />
                </div>
                <h3 className="mt-4 font-bold text-slate-900">No hay casos para mostrar</h3>
                <p className="mt-1 max-w-md text-sm leading-6 text-slate-500">
                  Asigna casos de uso a este clúster o habilita la visualización de casos inactivos.
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3 text-xs text-slate-500">
              <p>
                Selecciona un nodo para inspeccionar sus conexiones.
                {inferredEdges.length ? ` ${inferredEdges.length} flechas se generaron automáticamente según el orden del clúster.` : ""}
              </p>
              {externalConnections > 0 && selectedClusterId !== ALL_CLUSTERS ? (
                <p className="font-semibold text-slate-600">
                  {externalConnections} {externalConnections === 1 ? "conexión externa" : "conexiones externas"} ocultas
                </p>
              ) : null}
            </div>
          </section>

          {selectedGroup ? (
            <CaseDetail
              categoriesById={categoriesById}
              edges={selectedRelations}
              group={selectedGroup}
              groupsById={groupsById}
              onClose={() => setSelectedGroupId(null)}
            />
          ) : null}

          {visibleUnresolved.length ? (
            <section className="mt-6 rounded-[20px] border border-amber-200 bg-amber-50/60 p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                <div className="min-w-0">
                  <h3 className="font-bold text-amber-950">Referencias sin enlazar</h3>
                  <p className="mt-1 text-sm leading-6 text-amber-800">
                    Estos valores no coinciden con el código ni con el nombre de un caso de uso registrado.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {visibleUnresolved.slice(0, 12).map((reference, index) => (
                      <span key={`${reference.groupId}-${reference.kind}-${reference.value}-${index}`} className="rounded-full border border-amber-200 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900">
                        {groupsById.get(reference.groupId)?.use_case_code || groupsById.get(reference.groupId)?.name}
                        <ArrowRight className="mx-1.5 inline h-3 w-3" />
                        {reference.value}
                      </span>
                    ))}
                    {visibleUnresolved.length > 12 ? (
                      <span className="px-2 py-1.5 text-xs font-bold text-amber-700">+{visibleUnresolved.length - 12} más</span>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>
          ) : null}
      </main>
    </div>
  );
}

function CaseDetail({
  categoriesById,
  edges,
  group,
  groupsById,
  onClose,
}: {
  categoriesById: Map<string, CreditCatalogUseCaseCategory>;
  edges: GraphEdge[];
  group: CreditCatalogGroup;
  groupsById: Map<string, CreditCatalogGroup>;
  onClose: () => void;
}) {
  return (
    <section className="mt-6 rounded-[20px] border border-slate-200 bg-white p-5 shadow-[0_14px_42px_rgba(15,23,42,0.05)] sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[color-mix(in_oklab,var(--accent)_12%,white)] px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-[#0f766e]">
              {group.use_case_code?.trim() || "Sin código"}
            </span>
            {group.use_case_category_id ? (
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                {categoriesById.get(group.use_case_category_id)?.name ?? "Categoría no disponible"}
              </span>
            ) : null}
          </div>
          <h3 className="mt-3 text-xl font-black text-slate-950">{group.name}</h3>
          {group.description ? (
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{group.description}</p>
          ) : null}
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Cerrar detalle">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {(Object.keys(relationConfig) as RelationKind[]).map((kind) => {
          const related = edges
            .filter((edge) => edge.kind === kind)
            .map((edge) => groupsById.get(edge.sourceId === group.id ? edge.targetId : edge.sourceId))
            .filter((item): item is CreditCatalogGroup => Boolean(item));
          return (
            <div key={kind} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: relationConfig[kind].color }} />
                {relationConfig[kind].label}
              </div>
              <div className="mt-3 space-y-2">
                {related.length ? related.map((item) => (
                  <div key={item.id} className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                    <span className="shrink-0 text-xs font-black text-slate-400">{item.use_case_code || "—"}</span>
                    <span className="truncate">{item.name}</span>
                  </div>
                )) : <p className="text-sm text-slate-400">Sin conexiones</p>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
