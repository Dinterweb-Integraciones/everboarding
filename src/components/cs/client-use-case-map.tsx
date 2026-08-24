"use client";

import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Circle,
  Focus,
  Layers3,
  Minus,
  Network,
  Plus,
  Search,
  Sparkles,
  Trash2,
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
import {
  buildUseCaseEdges,
  CLUSTER_COLORS,
  getArrowPath,
  layoutGraph,
  NODE_RADIUS,
  normalizeReference,
  relationConfig,
  truncate,
  UNASSIGNED_COLOR,
  WITHOUT_CLUSTER,
  wrapNodeTitle,
  type GraphEdge,
  type RelationKind,
} from "@/lib/use-case-graph";
import { cn, safeParseNumber } from "@/lib/utils";

export type ClientOption = {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
};

export type ClientUseCaseProgressRow = {
  id: string;
  client_id: string;
  group_id: string;
  is_completed: boolean;
  completed_at: string | null;
};

type ClientUseCaseMapProps = {
  clients: ClientOption[];
  groups: CreditCatalogGroup[];
  clusters: CreditCatalogGroupCluster[];
  clusterLinks: CreditCatalogGroupClusterLink[];
  categories: CreditCatalogUseCaseCategory[];
  progress: ClientUseCaseProgressRow[];
};

const ALL_CLUSTERS = "__all__";

function progressKey(clientId: string, groupId: string) {
  return `${clientId}:${groupId}`;
}

export function ClientUseCaseMap({
  clients,
  groups,
  clusters,
  clusterLinks,
  categories,
  progress,
}: ClientUseCaseMapProps) {
  const sortedClients = useMemo(
    () =>
      [...clients].sort(
        (left, right) =>
          Number(right.is_active) - Number(left.is_active) || left.name.localeCompare(right.name, "es"),
      ),
    [clients],
  );
  const [selectedClientId, setSelectedClientId] = useState<string | null>(
    () => sortedClients[0]?.id ?? null,
  );
  const [progressByKey, setProgressByKey] = useState<Map<string, boolean>>(
    () => new Map(progress.map((row) => [progressKey(row.client_id, row.group_id), row.is_completed])),
  );
  const [pendingGroupId, setPendingGroupId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [addSearchTerm, setAddSearchTerm] = useState("");

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
  const codedGroups = useMemo(
    () => groups.filter((group) => Boolean(group.use_case_code?.trim())),
    [groups],
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
  const { edges, unresolvedReferences } = useMemo(() => buildUseCaseEdges(groups), [groups]);

  const clusterGroupIds = useMemo(() => {
    if (selectedClusterId === ALL_CLUSTERS) return new Set(groups.map((group) => group.id));
    if (selectedClusterId === WITHOUT_CLUSTER) {
      return new Set(groups.filter((group) => !linkedGroupIds.has(group.id)).map((group) => group.id));
    }
    return linksByCluster.get(selectedClusterId) ?? new Set<string>();
  }, [groups, linkedGroupIds, linksByCluster, selectedClusterId]);

  const includedGroupIds = useMemo(() => {
    if (!selectedClientId) return new Set<string>();
    const set = new Set<string>();
    groups.forEach((group) => {
      if (progressByKey.has(progressKey(selectedClientId, group.id))) set.add(group.id);
    });
    return set;
  }, [groups, progressByKey, selectedClientId]);
  const includedCodedGroups = useMemo(
    () => codedGroups.filter((group) => includedGroupIds.has(group.id)),
    [codedGroups, includedGroupIds],
  );
  const includedCountByCluster = useMemo(() => {
    const map = new Map<string, number>();
    linksByCluster.forEach((groupIds, clusterId) => {
      let count = 0;
      groupIds.forEach((id) => {
        if (includedGroupIds.has(id)) count += 1;
      });
      map.set(clusterId, count);
    });
    return map;
  }, [includedGroupIds, linksByCluster]);

  const visibleGroups = useMemo(
    () =>
      groups.filter(
        (group) =>
          includedGroupIds.has(group.id)
          && clusterGroupIds.has(group.id)
          && group.is_active
          && Boolean(group.use_case_code?.trim()),
      ),
    [clusterGroupIds, groups, includedGroupIds],
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
  const graph = useMemo(
    () => layoutGraph(
      visibleGroups,
      filteredEdges,
      primaryClusterByGroupId,
      selectedClusterId === ALL_CLUSTERS,
    ),
    [filteredEdges, primaryClusterByGroupId, selectedClusterId, visibleGroups],
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
  const selectedRelations = selectedGroup
    ? filteredEdges.filter((edge) => edge.sourceId === selectedGroup.id || edge.targetId === selectedGroup.id)
    : [];

  const completedGroupIds = useMemo(() => {
    if (!selectedClientId) return new Set<string>();
    const set = new Set<string>();
    groups.forEach((group) => {
      if (progressByKey.get(progressKey(selectedClientId, group.id))) set.add(group.id);
    });
    return set;
  }, [groups, progressByKey, selectedClientId]);

  // A case already in the map is "unlocked" once at least one of its logical predecessors is done.
  const unlockedGroupIds = useMemo(() => {
    if (!selectedClientId) return new Set<string>();
    const set = new Set<string>();
    edges.forEach((edge) => {
      if (edge.kind !== "logical") return;
      if (completedGroupIds.has(edge.sourceId) && !completedGroupIds.has(edge.targetId)) {
        set.add(edge.targetId);
      }
    });
    return set;
  }, [completedGroupIds, edges, selectedClientId]);

  // Catalog cases NOT yet in the map, but ready to be pulled in because their predecessor is done.
  const suggestedToAddGroupIds = useMemo(() => {
    if (!selectedClientId) return new Set<string>();
    const set = new Set<string>();
    edges.forEach((edge) => {
      if (edge.kind !== "logical") return;
      if (completedGroupIds.has(edge.sourceId) && !includedGroupIds.has(edge.targetId)) {
        set.add(edge.targetId);
      }
    });
    return set;
  }, [completedGroupIds, edges, includedGroupIds, selectedClientId]);

  const addableGroups = useMemo(() => {
    const normalizedAddSearch = normalizeReference(addSearchTerm);
    return codedGroups
      .filter((group) => !includedGroupIds.has(group.id))
      .filter(
        (group) =>
          !normalizedAddSearch
          || normalizeReference(group.name).includes(normalizedAddSearch)
          || normalizeReference(group.use_case_code ?? "").includes(normalizedAddSearch),
      )
      .sort((left, right) => left.name.localeCompare(right.name, "es"))
      .slice(0, 8);
  }, [addSearchTerm, codedGroups, includedGroupIds]);

  const suggestedToAddGroups = useMemo(
    () => codedGroups.filter((group) => suggestedToAddGroupIds.has(group.id)),
    [codedGroups, suggestedToAddGroupIds],
  );

  function selectCluster(clusterId: string) {
    setSelectedClusterId(clusterId);
    setSelectedGroupId(null);
    setHoveredGroupId(null);
    setZoom(1);
  }

  function toggleRelation(kind: RelationKind) {
    setVisibleRelations((current) => ({ ...current, [kind]: !current[kind] }));
  }

  async function saveCompletion(groupId: string, nextValue: boolean) {
    if (!selectedClientId) return;

    setPendingGroupId(groupId);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/cs/client-use-case-progress", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: selectedClientId, groupId, isCompleted: nextValue }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { is_completed?: boolean; message?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload?.message || "No pudimos actualizar el progreso del caso de uso.");
      }

      setProgressByKey((current) => {
        const next = new Map(current);
        next.set(progressKey(selectedClientId, groupId), Boolean(payload?.is_completed ?? nextValue));
        return next;
      });
    } catch (caughtError) {
      setErrorMessage(
        caughtError instanceof Error ? caughtError.message : "No pudimos actualizar el progreso del caso de uso.",
      );
    } finally {
      setPendingGroupId(null);
    }
  }

  function addCase(groupId: string) {
    return saveCompletion(groupId, false);
  }

  function toggleCompletion(groupId: string, nextValue: boolean) {
    return saveCompletion(groupId, nextValue);
  }

  async function removeCase(groupId: string) {
    if (!selectedClientId) return;

    setPendingGroupId(groupId);
    setErrorMessage(null);

    try {
      const response = await fetch(
        `/api/cs/client-use-case-progress?clientId=${selectedClientId}&groupId=${groupId}`,
        { method: "DELETE" },
      );
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;

      if (!response.ok) {
        throw new Error(payload?.message || "No pudimos quitar el caso de uso del mapa.");
      }

      setProgressByKey((current) => {
        const next = new Map(current);
        next.delete(progressKey(selectedClientId, groupId));
        return next;
      });
      setSelectedGroupId((current) => (current === groupId ? null : current));
    } catch (caughtError) {
      setErrorMessage(
        caughtError instanceof Error ? caughtError.message : "No pudimos quitar el caso de uso del mapa.",
      );
    } finally {
      setPendingGroupId(null);
    }
  }

  const selectedClient = selectedClientId
    ? sortedClients.find((client) => client.id === selectedClientId) ?? null
    : null;

  return (
    <div className="mx-auto w-full max-w-[1800px] px-4 py-8 sm:px-6 lg:px-8">
      <div className="rounded-[24px] border border-slate-200 bg-white px-6 py-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)] sm:px-8">
        <div className="inline-flex items-center gap-2 rounded-full bg-[color-mix(in_oklab,var(--accent)_11%,white)] px-3 py-1.5 text-xs font-bold uppercase tracking-[0.16em] text-[#0f766e]">
          <Network className="h-4 w-4" />
          Arquitectura de casos
        </div>
        <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
          Mapa de casos por cliente
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Elige un cliente y arma su mapa agregando casos de uso desde el catálogo. Marca los que ya completó
          y usa las sugerencias para saber qué agregar como siguiente paso lógico.
        </p>

        <label className="mt-4 block max-w-md space-y-1.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#99acc2]">Cliente</span>
          <Select
            value={selectedClientId ?? ""}
            onChange={(event) => {
              setSelectedClientId(event.target.value || null);
              setSelectedGroupId(null);
            }}
            className="h-11 font-semibold"
            aria-label="Seleccionar cliente"
          >
            {sortedClients.length === 0 ? <option value="">No hay clientes disponibles</option> : null}
            {sortedClients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
                {client.is_active ? "" : " (inactivo)"}
              </option>
            ))}
          </Select>
        </label>
      </div>

      {!selectedClient ? (
        <div className="mt-6 flex min-h-[300px] flex-col items-center justify-center rounded-[20px] border border-slate-200 bg-white px-6 text-center">
          <p className="text-sm font-semibold text-slate-500">Selecciona un cliente para construir su mapa.</p>
        </div>
      ) : (
        <main className="mt-6 min-w-0">
          <AddCasePanel
            addSearchTerm={addSearchTerm}
            addableGroups={addableGroups}
            onAdd={addCase}
            pendingGroupId={pendingGroupId}
            setAddSearchTerm={setAddSearchTerm}
            suggestedToAddGroups={suggestedToAddGroups}
          />

          <section className="mt-6 overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-[0_14px_42px_rgba(15,23,42,0.05)]">
            <div className="border-b border-slate-200 px-4 py-4 sm:px-5">
              <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-center 2xl:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Layers3 className="h-4 w-4 shrink-0 text-[var(--accent)]" />
                    <h2 className="truncate text-lg font-black text-slate-950">{clusterTitle}</h2>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {completedGroupIds.size} de {includedGroupIds.size} casos completados por {selectedClient.name}.
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
                      <option value={ALL_CLUSTERS}>Todos los clústeres · Vista general ({includedGroupIds.size})</option>
                      {sortedClusters.map((cluster) => (
                        <option key={cluster.id} value={cluster.id}>
                          {cluster.label} ({includedCountByCluster.get(cluster.id) ?? 0})
                        </option>
                      ))}
                      <option value={WITHOUT_CLUSTER}>
                        Sin clúster ({includedCodedGroups.filter((group) => !linkedGroupIds.has(group.id)).length})
                      </option>
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
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 pt-3">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Completado
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                  <Sparkles className="h-3.5 w-3.5 text-amber-500" /> Sugerido como siguiente
                </span>
                {(selectedClusterId === ALL_CLUSTERS
                  ? sortedClusters.filter((cluster) => (includedCountByCluster.get(cluster.id) ?? 0) > 0)
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
                {selectedClusterId === ALL_CLUSTERS
                  && includedCodedGroups.some((group) => !linkedGroupIds.has(group.id)) ? (
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
                  aria-label={`${visibleGroups.length} casos de uso y ${filteredEdges.length} relaciones`}
                >
                  <defs>
                    {[...new Set([...clusterColorById.values(), UNASSIGNED_COLOR])].map((color) => (
                      <marker
                        key={color}
                        id={`client-cluster-arrow-${color.slice(1)}`}
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
                    <filter id="client-node-shadow" x="-20%" y="-20%" width="140%" height="150%">
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
                        markerEnd={`url(#client-cluster-arrow-${edgeColor.slice(1)})`}
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
                    const isCompleted = completedGroupIds.has(node.group.id);
                    const isSuggested = !isCompleted && unlockedGroupIds.has(node.group.id);
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
                        aria-label={`${code}: ${node.group.name}${isCompleted ? " (completado)" : ""}`}
                        opacity={muted ? 0.28 : 1}
                      >
                        <title>{`${code}: ${node.group.name}`}</title>
                        {selected ? (
                          <circle r="35" fill={nodeColor} opacity="0.16" />
                        ) : null}
                        {isSuggested ? (
                          <circle
                            r={NODE_RADIUS + 6}
                            fill="none"
                            stroke="#f59e0b"
                            strokeWidth="2.5"
                            strokeDasharray="4 4"
                          />
                        ) : null}
                        <circle
                          r={NODE_RADIUS}
                          fill={nodeColor}
                          stroke={isCompleted ? "#059669" : node.group.is_active ? "#ffffff" : "#fb7185"}
                          strokeWidth={selected ? 4 : isCompleted ? 3.5 : node.group.is_active ? 2.5 : 4}
                          filter="url(#client-node-shadow)"
                          opacity={isCompleted ? 0.55 : 1}
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
                        {isCompleted ? (
                          <g transform="translate(-18 -18)">
                            <circle r="8" fill="#059669" stroke="#ffffff" strokeWidth="2" />
                            <path
                              d="M -3.2 0 L -1 2.4 L 3.4 -2.6"
                              fill="none"
                              stroke="#ffffff"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </g>
                        ) : !node.group.is_active ? (
                          <circle cx="-18" cy="-18" r="5" fill="#fb7185" stroke="#ffffff" strokeWidth="2" />
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
                          filter="url(#client-node-shadow)"
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
                <h3 className="mt-4 font-bold text-slate-900">
                  {includedGroupIds.size === 0 ? "El mapa de este cliente está vacío" : "No hay casos en este clúster"}
                </h3>
                <p className="mt-1 max-w-md text-sm leading-6 text-slate-500">
                  {includedGroupIds.size === 0
                    ? "Agrega el primer caso de uso desde el buscador de arriba para empezar a construir el mapa."
                    : "Cambia de clúster o agrega más casos de uso desde el buscador de arriba."}
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3 text-xs text-slate-500">
              <p>Selecciona un nodo para marcarlo como completado y ver sus conexiones.</p>
            </div>
          </section>

          {errorMessage ? (
            <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
              {errorMessage}
            </p>
          ) : null}

          {selectedGroup && selectedClientId ? (
            <ClientCaseDetail
              categoriesById={categoriesById}
              completedGroupIds={completedGroupIds}
              edges={selectedRelations}
              group={selectedGroup}
              groupsById={groupsById}
              isCompleted={completedGroupIds.has(selectedGroup.id)}
              isPending={pendingGroupId === selectedGroup.id}
              onClose={() => setSelectedGroupId(null)}
              onRemove={() => removeCase(selectedGroup.id)}
              onToggleCompleted={(nextValue) => toggleCompletion(selectedGroup.id, nextValue)}
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
      )}
    </div>
  );
}

function AddCasePanel({
  addSearchTerm,
  addableGroups,
  onAdd,
  pendingGroupId,
  setAddSearchTerm,
  suggestedToAddGroups,
}: {
  addSearchTerm: string;
  addableGroups: CreditCatalogGroup[];
  onAdd: (groupId: string) => void;
  pendingGroupId: string | null;
  setAddSearchTerm: (value: string) => void;
  suggestedToAddGroups: CreditCatalogGroup[];
}) {
  return (
    <section className="overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-[0_14px_42px_rgba(15,23,42,0.05)]">
      <div className="border-b border-slate-100 px-4 py-4 sm:px-5">
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4 text-[var(--accent)]" />
          <h3 className="text-sm font-black uppercase tracking-[0.1em] text-slate-700">Agregar caso de uso</h3>
        </div>
        <div className="relative mt-3 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={addSearchTerm}
            onChange={(event) => setAddSearchTerm(event.target.value)}
            placeholder="Buscar caso o código en el catálogo"
            className="h-10 pl-9"
          />
        </div>
        {addSearchTerm ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {addableGroups.length === 0 ? (
              <p className="text-sm text-slate-400">No encontramos casos que coincidan con la búsqueda.</p>
            ) : (
              addableGroups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  disabled={pendingGroupId === group.id}
                  onClick={() => onAdd(group.id)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:border-[var(--accent)] hover:bg-white disabled:cursor-wait disabled:opacity-60"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {group.use_case_code ? `${group.use_case_code} · ` : ""}
                  {group.name}
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>

      {suggestedToAddGroups.length ? (
        <div className="px-4 py-4 sm:px-5">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-amber-600">
            <Sparkles className="h-3.5 w-3.5" />
            Sugeridos para agregar
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Ya completó el caso previo, así que estos son un siguiente paso lógico.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {suggestedToAddGroups.map((group) => (
              <button
                key={group.id}
                type="button"
                disabled={pendingGroupId === group.id}
                onClick={() => onAdd(group.id)}
                className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800 transition hover:border-amber-400 hover:bg-amber-100 disabled:cursor-wait disabled:opacity-60"
              >
                <Plus className="h-3.5 w-3.5" />
                {group.use_case_code ? `${group.use_case_code} · ` : ""}
                {group.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ClientCaseDetail({
  categoriesById,
  completedGroupIds,
  edges,
  group,
  groupsById,
  isCompleted,
  isPending,
  onClose,
  onRemove,
  onToggleCompleted,
}: {
  categoriesById: Map<string, CreditCatalogUseCaseCategory>;
  completedGroupIds: Set<string>;
  edges: GraphEdge[];
  group: CreditCatalogGroup;
  groupsById: Map<string, CreditCatalogGroup>;
  isCompleted: boolean;
  isPending: boolean;
  onClose: () => void;
  onRemove: () => void;
  onToggleCompleted: (nextValue: boolean) => void;
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
            {isCompleted ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" /> Completado
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

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => onToggleCompleted(!isCompleted)}
          className={cn(
            "inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-black transition disabled:cursor-wait disabled:opacity-60",
            isCompleted
              ? "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
              : "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700",
          )}
        >
          {isCompleted ? <Circle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
          {isPending ? "Guardando..." : isCompleted ? "Marcar como pendiente" : "Marcar como completado"}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={onRemove}
          className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-sm font-black text-rose-600 transition hover:bg-rose-50 disabled:cursor-wait disabled:opacity-60"
        >
          <Trash2 className="h-4 w-4" />
          Quitar del mapa
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
                    {completedGroupIds.has(item.id) ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    ) : (
                      <Circle className="h-3.5 w-3.5 shrink-0 text-slate-300" />
                    )}
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
