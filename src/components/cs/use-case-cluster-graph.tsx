"use client";

import {
  AlertTriangle,
  ArrowRight,
  Check,
  Focus,
  Layers3,
  Maximize2,
  Minimize2,
  Minus,
  Network,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { RichTextDisplay } from "@/components/ui/rich-text";
import {
  CLIENT_USE_CASE_STATUS_COLORS,
  CLIENT_USE_CASE_STATUS_LABELS,
  type ClientUseCaseDisplayStatus,
  type ClientUseCaseStatus,
} from "@/lib/client-use-case-status";
import type {
  CreditCatalogGroup,
  CreditCatalogGroupCluster,
  CreditCatalogGroupClusterLink,
  CreditCatalogUseCaseCategory,
} from "@/lib/onboarding";
import {
  buildUseCaseEdges,
  CLUSTER_COLORS,
  HUB_RADIUS,
  layoutClusterStars,
  normalizeReference,
  relationConfig,
  truncate,
  UNASSIGNED_COLOR,
  WITHOUT_CLUSTER,
  wrapNodeTitle,
  wrapStarLabel,
  type ClusterStarGroup,
  type GraphEdge,
  type RelationKind,
} from "@/lib/use-case-graph";
import { safeParseNumber } from "@/lib/utils";

type UseCaseClusterGraphProps = {
  groups: CreditCatalogGroup[];
  clusters: CreditCatalogGroupCluster[];
  clusterLinks: CreditCatalogGroupClusterLink[];
  categories: CreditCatalogUseCaseCategory[];
  statusByGroupId?: Map<string, ClientUseCaseStatus>;
  onAddToStage?: (group: CreditCatalogGroup, status: "backlog" | "planned") => void;
  addingGroupId?: string | null;
};

export function UseCaseClusterGraph({
  groups,
  clusters,
  clusterLinks,
  categories,
  statusByGroupId,
  onAddToStage,
  addingGroupId,
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
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [hoveredGroupId, setHoveredGroupId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [zoom, setZoom] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showUnclustered, setShowUnclustered] = useState(false);

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
  const { edges, unresolvedReferences } = useMemo(() => buildUseCaseEdges(groups), [groups]);

  const visibleGroups = useMemo(
    () => groups.filter((group) => group.is_active && Boolean(group.use_case_code?.trim())),
    [groups],
  );
  const linkedGroupIds = useMemo(
    () => new Set(clusterLinks.map((link) => link.group_id)),
    [clusterLinks],
  );
  const unclusteredGroups = useMemo(
    () => visibleGroups.filter((group) => !linkedGroupIds.has(group.id)),
    [linkedGroupIds, visibleGroups],
  );

  // By default the map only shows clusters with at least one linked, active
  // use case — cases without a cluster assignment are noise on the map, but
  // they still need to be selectable (to add them to Planificación/Evaluación),
  // so `showUnclustered` reveals them as their own "Sin clúster" star instead
  // of always cluttering the default view.
  const clusterStarGroups: ClusterStarGroup[] = useMemo(() => {
    const groupById = new Map(visibleGroups.map((group) => [group.id, group]));
    const stars = sortedClusters
      .map((cluster) => ({
        id: cluster.id,
        label: cluster.label,
        color: clusterColorById.get(cluster.id) ?? UNASSIGNED_COLOR,
        groups: [...(linksByCluster.get(cluster.id) ?? new Set<string>())]
          .map((groupId) => groupById.get(groupId))
          .filter((group): group is CreditCatalogGroup => Boolean(group)),
      }))
      .filter((star) => star.groups.length > 0);

    if (showUnclustered && unclusteredGroups.length > 0) {
      stars.push({
        id: WITHOUT_CLUSTER,
        label: "Sin clúster",
        color: UNASSIGNED_COLOR,
        groups: unclusteredGroups,
      });
    }

    return stars;
  }, [clusterColorById, linksByCluster, showUnclustered, sortedClusters, unclusteredGroups, visibleGroups]);

  const clusteredGroupIds = useMemo(
    () => new Set(clusterStarGroups.flatMap((star) => star.groups.map((group) => group.id))),
    [clusterStarGroups],
  );

  const relationLines = useMemo(() => {
    const seen = new Set<string>();
    const pairs: { id: string; a: string; b: string }[] = [];
    edges.forEach((edge) => {
      if (!clusteredGroupIds.has(edge.sourceId) || !clusteredGroupIds.has(edge.targetId)) return;
      const key = [edge.sourceId, edge.targetId].sort().join(":");
      if (seen.has(key)) return;
      seen.add(key);
      pairs.push({ id: key, a: edge.sourceId, b: edge.targetId });
    });
    return pairs;
  }, [clusteredGroupIds, edges]);

  const graph = useMemo(() => layoutClusterStars(clusterStarGroups), [clusterStarGroups]);
  // Built from the graph's own spokes (rather than clusterIdsByGroupId, which
  // only tracks real DB links) so it also covers the synthetic "Sin clúster"
  // star — clicking that hub should still highlight its own members.
  const hubIdsByGroupId = useMemo(() => {
    const map = new Map<string, string[]>();
    graph.spokes.forEach((spoke) => {
      const current = map.get(spoke.groupId) ?? [];
      current.push(spoke.hubId);
      map.set(spoke.groupId, current);
    });
    return map;
  }, [graph.spokes]);
  const positionedById = useMemo(
    () => new Map(graph.nodes.map((node) => [node.group.id, node])),
    [graph.nodes],
  );
  const normalizedSearch = normalizeReference(searchQuery);
  const selectedGroup = selectedGroupId ? groupsById.get(selectedGroupId) ?? null : null;
  const selectedRelations = selectedGroup
    ? edges.filter((edge) => edge.sourceId === selectedGroup.id || edge.targetId === selectedGroup.id)
    : [];

  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
    moved: boolean;
  } | null>(null);
  const justDraggedRef = useRef(false);

  function handleMapPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    // Only pan-drag when the gesture starts on empty canvas — starting it on
    // a node/hub (role="button") would hijack pointer capture and prevent
    // the click that opens the case-detail modal from ever reaching it.
    if ((event.target as Element).closest('[role="button"]')) return;
    const container = event.currentTarget;
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: container.scrollLeft,
      scrollTop: container.scrollTop,
      moved: false,
    };
    container.setPointerCapture(event.pointerId);
  }

  function handleMapPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const container = event.currentTarget;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
      drag.moved = true;
    }
    container.scrollLeft = drag.scrollLeft - deltaX;
    container.scrollTop = drag.scrollTop - deltaY;
  }

  function handleMapPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    justDraggedRef.current = drag.moved;
    dragStateRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released — safe to ignore.
    }
    // The click that immediately follows a real mouse-up consumes the flag
    // synchronously; this timeout only clears it if no click ever arrives
    // (e.g. the pointer left the element), so it never masks a later click.
    window.setTimeout(() => {
      justDraggedRef.current = false;
    }, 0);
  }

  function clearSelection() {
    setSelectedGroupId(null);
    setSelectedClusterId(null);
  }

  return (
    <div className={isFullscreen ? "fixed inset-0 z-50 flex flex-col bg-slate-900/40 p-4 backdrop-blur-sm" : "w-full min-w-0"}>
      <section
        className={`overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-[0_14px_42px_rgba(15,23,42,0.05)] ${
          isFullscreen ? "flex min-h-0 flex-1 flex-col" : ""
        }`}
      >
        <div className="border-b border-slate-200 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-center 2xl:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Layers3 className="h-4 w-4 shrink-0 text-[var(--accent)]" />
                <h2 className="truncate text-lg font-black text-slate-950">Mapa de casos de uso</h2>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Cada clúster tiene su propio nodo central; los casos relacionados salen de él. Arrastra para mover el
                mapa, haz clic en un clúster para resaltar sus casos, o en un caso para ver el detalle.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
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

              <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
                <button
                  type="button"
                  onClick={() => setZoom((current) => Math.max(0.1, Number((current - 0.1).toFixed(1))))}
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

              <button
                type="button"
                onClick={() => setIsFullscreen((current) => !current)}
                className="rounded-xl border border-slate-200 bg-white p-2.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                aria-label={isFullscreen ? "Salir de pantalla completa" : "Ver en pantalla completa"}
                title={isFullscreen ? "Salir de pantalla completa" : "Ver en pantalla completa"}
              >
                {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>

              {unclusteredGroups.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowUnclustered((current) => !current)}
                  className={`rounded-xl border px-3 py-2.5 text-xs font-bold transition ${
                    showUnclustered
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                  title="Casos activos que todavia no estan asignados a ningun clúster"
                >
                  Sin clúster ({unclusteredGroups.length})
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {clusteredGroupIds.size ? (
          <div className={`relative min-h-0 ${isFullscreen ? "flex-1" : ""}`}>
          <div
            onPointerDown={handleMapPointerDown}
            onPointerMove={handleMapPointerMove}
            onPointerUp={handleMapPointerUp}
            onPointerCancel={handleMapPointerUp}
            onClick={clearSelection}
            className={`${
              isFullscreen ? "h-full" : "h-[78vh] min-h-[720px] max-h-[980px]"
            } cursor-grab touch-none select-none overflow-auto bg-[radial-gradient(circle_at_1px_1px,#dbe4ee_1px,transparent_0)] [background-size:22px_22px] active:cursor-grabbing`}
            aria-label="Mapa de casos de uso"
          >
            <svg
              className="min-h-full min-w-full"
              width={graph.width * zoom}
              height={graph.height * zoom}
              viewBox={`0 0 ${graph.width} ${graph.height}`}
              role="img"
              aria-label={`${clusteredGroupIds.size} casos de uso agrupados en ${graph.hubs.length} clústeres`}
            >
              <defs>
                <filter id="node-shadow" x="-20%" y="-20%" width="140%" height="150%">
                  <feDropShadow dx="0" dy="5" stdDeviation="7" floodColor="#0f172a" floodOpacity="0.09" />
                </filter>
              </defs>

              {graph.spokes.map((spoke) => {
                const hub = graph.hubs.find((candidate) => candidate.id === spoke.hubId);
                const node = positionedById.get(spoke.groupId);
                if (!hub || !node) return null;
                const isMuted = selectedGroupId
                  ? spoke.groupId !== selectedGroupId
                  : selectedClusterId
                    ? spoke.hubId !== selectedClusterId
                    : false;
                return (
                  <line
                    key={`${spoke.hubId}-${spoke.groupId}`}
                    x1={hub.x}
                    y1={hub.y}
                    x2={node.x}
                    y2={node.y}
                    stroke={spoke.color}
                    strokeWidth={1.5}
                    opacity={isMuted ? 0.08 : 0.32}
                  />
                );
              })}

              {relationLines.map((line) => {
                const a = positionedById.get(line.a);
                const b = positionedById.get(line.b);
                if (!a || !b) return null;
                const isMuted = selectedGroupId
                  ? line.a !== selectedGroupId && line.b !== selectedGroupId
                  : selectedClusterId
                    ? !(hubIdsByGroupId.get(line.a) ?? []).includes(selectedClusterId)
                      && !(hubIdsByGroupId.get(line.b) ?? []).includes(selectedClusterId)
                    : false;
                return (
                  <line
                    key={line.id}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke="#94a3b8"
                    strokeWidth={isMuted ? 1 : 1.5}
                    strokeDasharray="6 6"
                    opacity={isMuted ? 0.1 : 0.55}
                  />
                );
              })}

              {graph.nodes.map((node) => {
                const nodeRadius = graph.nodeRadiusById.get(node.group.id) ?? 18;
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
                const clusterId = primaryClusterByGroupId.get(node.group.id);
                const nodeClusterIds = clusterIdsByGroupId.get(node.group.id) ?? [];
                const inSelectedCluster = selectedClusterId
                  ? (hubIdsByGroupId.get(node.group.id) ?? []).includes(selectedClusterId)
                  : true;
                const muted = !matchesSearch || !connectedToSelection || !inSelectedCluster;
                const selected = selectedGroupId === node.group.id;
                const nodeColor = clusterId
                  ? clusterColorById.get(clusterId) ?? UNASSIGNED_COLOR
                  : UNASSIGNED_COLOR;
                const clientStatus: ClientUseCaseDisplayStatus =
                  statusByGroupId?.get(node.group.id) ?? "untouched";
                const isCompleted = clientStatus === "completed";
                return (
                  <g
                    key={node.group.id}
                    transform={`translate(${node.x} ${node.y})`}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (justDraggedRef.current) {
                        justDraggedRef.current = false;
                        return;
                      }
                      setSelectedGroupId(node.group.id);
                      setSelectedClusterId(null);
                    }}
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
                        setSelectedGroupId(node.group.id);
                        setSelectedClusterId(null);
                      }
                    }}
                    aria-label={`${code}: ${node.group.name}`}
                    opacity={muted ? 0.28 : 1}
                  >
                    <title>{`${code}: ${node.group.name}`}</title>
                    {selected ? (
                      <circle r={nodeRadius + 10} fill={nodeColor} opacity="0.16" />
                    ) : null}
                    {statusByGroupId && !isCompleted && clientStatus !== "untouched" ? (
                      <circle
                        r={nodeRadius + 5}
                        fill="none"
                        stroke={CLIENT_USE_CASE_STATUS_COLORS[clientStatus].fill}
                        strokeWidth={3}
                      />
                    ) : null}
                    <circle
                      r={nodeRadius}
                      fill={nodeColor}
                      stroke={node.group.is_active ? "#ffffff" : "#fb7185"}
                      strokeWidth={selected ? 4 : node.group.is_active ? 2.5 : 4}
                      filter="url(#node-shadow)"
                    />
                    <text
                      x="0"
                      y="3.5"
                      textAnchor="middle"
                      fontSize={code.length > 8 ? Math.max(6, nodeRadius * 0.34) : Math.max(7.5, nodeRadius * 0.44)}
                      fontWeight="850"
                      fill="#ffffff"
                      letterSpacing="0.02em"
                    >
                      {truncate(code, 10)}
                    </text>
                    {!node.group.is_active ? (
                      <circle cx={nodeRadius - 7} cy={-nodeRadius + 7} r="5" fill="#fb7185" stroke="#ffffff" strokeWidth="2" />
                    ) : null}
                    {statusByGroupId && isCompleted ? (
                      <g transform={`translate(${nodeRadius - 6} ${nodeRadius - 6})`}>
                        <circle r="7" fill={CLIENT_USE_CASE_STATUS_COLORS.completed.fill} stroke="#ffffff" strokeWidth="2" />
                        <path
                          d="M -3 0 L -0.8 2.4 L 3.2 -2.6"
                          fill="none"
                          stroke="#ffffff"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </g>
                    ) : null}
                    {nodeClusterIds.length > 1 ? nodeClusterIds.slice(1, 5).map((secondaryClusterId, index) => (
                      <circle
                        key={secondaryClusterId}
                        cx={(index - Math.min(1.5, (nodeClusterIds.length - 2) / 2)) * 9}
                        cy={nodeRadius + 7}
                        r="3.5"
                        fill={clusterColorById.get(secondaryClusterId) ?? UNASSIGNED_COLOR}
                        stroke="#ffffff"
                        strokeWidth="1.5"
                      />
                    )) : null}
                  </g>
                );
              })}

              {graph.hubs.map((hub) => {
                const hubSelected = selectedClusterId === hub.id;
                const hubMuted = selectedClusterId ? !hubSelected : false;
                return (
                  <g
                    key={hub.id}
                    transform={`translate(${hub.x} ${hub.y})`}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (justDraggedRef.current) {
                        justDraggedRef.current = false;
                        return;
                      }
                      setSelectedClusterId((current) => (current === hub.id ? null : hub.id));
                      setSelectedGroupId(null);
                    }}
                    className="cursor-pointer outline-none"
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedClusterId((current) => (current === hub.id ? null : hub.id));
                        setSelectedGroupId(null);
                      }
                    }}
                    aria-label={`Clúster ${hub.label}`}
                    opacity={hubMuted ? 0.35 : 1}
                  >
                    <title>{hub.label}</title>
                    {hubSelected ? <circle r={HUB_RADIUS + 10} fill={hub.color} opacity="0.18" /> : null}
                    <circle
                      r={HUB_RADIUS}
                      fill={hub.color}
                      stroke="#ffffff"
                      strokeWidth={hubSelected ? 4 : 2}
                      filter="url(#node-shadow)"
                    />
                    {wrapStarLabel(hub.label, 13).map((line, index, arr) => (
                      <text
                        key={`${hub.id}-${line}-${index}`}
                        textAnchor="middle"
                        x="0"
                        y={5 + index * 15 - ((arr.length - 1) * 7.5)}
                        fontSize="12"
                        fontWeight="800"
                        fill="#ffffff"
                      >
                        {line}
                      </text>
                    ))}
                  </g>
                );
              })}

              {hoveredGroupId ? (() => {
                const hoveredNode = positionedById.get(hoveredGroupId);
                if (!hoveredNode) return null;
                const hoveredRadius = graph.nodeRadiusById.get(hoveredGroupId) ?? 18;
                const tooltipLines = wrapNodeTitle(hoveredNode.group.name);
                const tooltipWidth = Math.max(
                  176,
                  Math.min(260, Math.max(...tooltipLines.map((line) => line.length)) * 7 + 28),
                );
                const showOnLeft = hoveredNode.x + hoveredRadius + 16 + tooltipWidth > graph.width - 18;
                const tooltipX = showOnLeft
                  ? hoveredNode.x - hoveredRadius - tooltipWidth - 16
                  : hoveredNode.x + hoveredRadius + 16;
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

          {statusByGroupId ? (
            <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-[11px] font-semibold text-slate-600 shadow-md backdrop-blur">
              <span className="flex items-center gap-1.5">
                <span
                  className="h-3 w-3 rounded-full border-2 bg-white"
                  style={{ borderColor: CLIENT_USE_CASE_STATUS_COLORS.executing.fill }}
                />
                En ejecución
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="h-3 w-3 rounded-full border-2 bg-white"
                  style={{ borderColor: CLIENT_USE_CASE_STATUS_COLORS.planned.fill }}
                />
                Planificado
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="h-3 w-3 rounded-full border-2 bg-white"
                  style={{ borderColor: CLIENT_USE_CASE_STATUS_COLORS.evaluating.fill }}
                />
                En evaluación
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="flex h-3.5 w-3.5 items-center justify-center rounded-full"
                  style={{ backgroundColor: CLIENT_USE_CASE_STATUS_COLORS.completed.fill }}
                >
                  <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />
                </span>
                Completado
              </span>
            </div>
          ) : null}
          </div>
        ) : (
          <div className="flex min-h-[500px] flex-col items-center justify-center px-6 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
              <Network className="h-7 w-7" />
            </div>
            <h3 className="mt-4 font-bold text-slate-900">No hay casos para mostrar</h3>
            <p className="mt-1 max-w-md text-sm leading-6 text-slate-500">
              Asigna casos de uso a un clúster o habilita la visualización de casos inactivos.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3 text-xs text-slate-500">
          <p>Línea sólida: pertenece al clúster · línea punteada: relación real entre dos casos de uso.</p>
        </div>
      </section>

      {selectedGroup ? (
        <CaseDetailModal
          categoriesById={categoriesById}
          edges={selectedRelations}
          group={selectedGroup}
          groupsById={groupsById}
          onClose={() => setSelectedGroupId(null)}
          onSelectGroup={(groupId) => setSelectedGroupId(groupId)}
          status={statusByGroupId?.get(selectedGroup.id) ?? "untouched"}
          onAddToStage={onAddToStage}
          isAdding={addingGroupId === selectedGroup.id}
        />
      ) : null}

      {unresolvedReferences.length ? (
        <section className="mt-6 rounded-[20px] border border-amber-200 bg-amber-50/60 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="min-w-0">
              <h3 className="font-bold text-amber-950">Referencias sin enlazar</h3>
              <p className="mt-1 text-sm leading-6 text-amber-800">
                Estos valores no coinciden con el código ni con el nombre de un caso de uso registrado.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {unresolvedReferences.slice(0, 12).map((reference, index) => (
                  <span key={`${reference.groupId}-${reference.kind}-${reference.value}-${index}`} className="rounded-full border border-amber-200 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900">
                    {groupsById.get(reference.groupId)?.use_case_code || groupsById.get(reference.groupId)?.name}
                    <ArrowRight className="mx-1.5 inline h-3 w-3" />
                    {reference.value}
                  </span>
                ))}
                {unresolvedReferences.length > 12 ? (
                  <span className="px-2 py-1.5 text-xs font-bold text-amber-700">+{unresolvedReferences.length - 12} más</span>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function CaseDetailModal({
  categoriesById,
  edges,
  group,
  groupsById,
  onClose,
  onSelectGroup,
  status = "untouched",
  onAddToStage,
  isAdding = false,
}: {
  categoriesById: Map<string, CreditCatalogUseCaseCategory>;
  edges: GraphEdge[];
  group: CreditCatalogGroup;
  groupsById: Map<string, CreditCatalogGroup>;
  onClose: () => void;
  onSelectGroup: (groupId: string) => void;
  status?: ClientUseCaseDisplayStatus;
  onAddToStage?: (group: CreditCatalogGroup, status: "backlog" | "planned") => void;
  isAdding?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <section
        onClick={(event) => event.stopPropagation()}
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-[20px] border border-slate-200 bg-white p-5 shadow-2xl sm:p-6"
      >
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
              {onAddToStage ? (
                <span
                  className="rounded-full px-3 py-1 text-xs font-bold"
                  style={{
                    backgroundColor: `color-mix(in oklab, ${CLIENT_USE_CASE_STATUS_COLORS[status].fill} 16%, white)`,
                    color: CLIENT_USE_CASE_STATUS_COLORS[status].fill,
                  }}
                >
                  {CLIENT_USE_CASE_STATUS_LABELS[status]}
                </span>
              ) : null}
            </div>
            <h3 className="mt-3 text-xl font-black text-slate-950">{group.name}</h3>
            {group.description ? (
              <RichTextDisplay value={group.description} className="mt-2 max-w-3xl text-slate-600" />
            ) : null}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Cerrar detalle">
            <X className="h-5 w-5" />
          </button>
        </div>

        {onAddToStage && status === "untouched" ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={isAdding}
              onClick={() => onAddToStage(group, "planned")}
              className="rounded-full bg-[#14b8a6] px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-[#0ea899] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Incluir en Planificación
            </button>
            <button
              type="button"
              disabled={isAdding}
              onClick={() => onAddToStage(group, "backlog")}
              className="rounded-full bg-[#5f7ea2] px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-[#4f6f92] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Dejar en Evaluación
            </button>
          </div>
        ) : null}

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
                <div className="mt-3 space-y-1.5">
                  {related.length ? related.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelectGroup(item.id)}
                      className="flex w-full items-start gap-2 rounded-lg px-1.5 py-1 text-left text-sm font-semibold text-slate-800 transition hover:bg-white hover:text-[#0f766e]"
                    >
                      <span className="mt-0.5 shrink-0 text-xs font-black text-slate-400">{item.use_case_code || "—"}</span>
                      <span className="leading-snug">{item.name}</span>
                    </button>
                  )) : <p className="text-sm text-slate-400">Sin conexiones</p>}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
