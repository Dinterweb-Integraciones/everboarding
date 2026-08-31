"use client";

import { Library, Map as MapIcon, Network } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { UseCaseDetailPanel } from "@/components/cs/use-case-detail-panel";
import { UseCaseLibrary } from "@/components/cs/use-case-library";
import {
  DEFAULT_NODE_ICON,
  MAX_MAP_NODES,
  UseCaseStarMap,
  type RouteItem,
} from "@/components/cs/use-case-star-map";
import { Select } from "@/components/ui/select";
import {
  computeGroupStatusForClient,
  type ClientUseCaseInitiative,
} from "@/lib/client-use-case-status";
import type {
  CreditCatalogGroup,
  CreditCatalogGroupCluster,
  CreditCatalogGroupClusterLink,
  CreditCatalogUseCaseCategory,
} from "@/lib/onboarding";
import { buildUseCaseEdges, CLUSTER_COLORS } from "@/lib/use-case-graph";
import { cn, safeParseNumber } from "@/lib/utils";

export type ClientOption = {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
};

export type ClientUseCaseRouteRow = {
  client_id: string;
  group_id: string;
  position: number;
  icon: string | null;
};

type ClientUseCaseMapProps = {
  clients: ClientOption[];
  groups: CreditCatalogGroup[];
  clusters: CreditCatalogGroupCluster[];
  clusterLinks: CreditCatalogGroupClusterLink[];
  categories: CreditCatalogUseCaseCategory[];
  initiatives: ClientUseCaseInitiative[];
  routes: ClientUseCaseRouteRow[];
};

type ViewMode = "builder" | "library";

export function ClientUseCaseMap({
  clients,
  groups,
  clusters,
  clusterLinks,
  categories,
  initiatives,
  routes,
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

  const routeItemsByClient = useMemo(() => {
    const map = new Map<string, RouteItem[]>();
    [...routes]
      .sort((left, right) => left.position - right.position)
      .forEach((row) => {
        const current = map.get(row.client_id) ?? [];
        current.push({ groupId: row.group_id, icon: row.icon || DEFAULT_NODE_ICON });
        map.set(row.client_id, current);
      });
    return map;
  }, [routes]);
  const [routeItems, setRouteItems] = useState<RouteItem[]>(
    () => routeItemsByClient.get(selectedClientId ?? "") ?? [],
  );
  const [isSavingRoute, setIsSavingRoute] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("builder");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  useEffect(() => {
    setRouteItems(routeItemsByClient.get(selectedClientId ?? "") ?? []);
    setSelectedGroupId(null);
  }, [selectedClientId, routeItemsByClient]);

  useEffect(() => {
    if (!selectedGroupId) return;

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setSelectedGroupId(null);
    }

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [selectedGroupId]);

  const sortedClusters = useMemo(
    () =>
      [...clusters].sort(
        (left, right) =>
          safeParseNumber(left.sort_order) - safeParseNumber(right.sort_order)
          || left.label.localeCompare(right.label, "es"),
      ),
    [clusters],
  );
  const linkedGroupIds = useMemo(
    () => new Set(clusterLinks.map((link) => link.group_id)),
    [clusterLinks],
  );
  const codedGroups = useMemo(
    () => groups.filter((group) => group.is_active && Boolean(group.use_case_code?.trim())),
    [groups],
  );

  const clusterColorById = useMemo(
    () => new Map(sortedClusters.map((cluster, index) => [cluster.id, CLUSTER_COLORS[index % CLUSTER_COLORS.length]])),
    [sortedClusters],
  );
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
  const { edges } = useMemo(() => buildUseCaseEdges(groups), [groups]);

  const clientInitiatives = useMemo(
    () =>
      selectedClientId
        ? initiatives.filter((initiative) => initiative.client_id === selectedClientId)
        : [],
    [initiatives, selectedClientId],
  );
  const statusByGroupId = useMemo(
    () => computeGroupStatusForClient(clientInitiatives, groups),
    [clientInitiatives, groups],
  );
  const completedGroupIds = useMemo(() => {
    const set = new Set<string>();
    statusByGroupId.forEach((status, groupId) => {
      if (status === "completed") set.add(groupId);
    });
    return set;
  }, [statusByGroupId]);

  const mappedGroupIds = useMemo(() => new Set(routeItems.map((item) => item.groupId)), [routeItems]);
  const candidateGroups = useMemo(
    () => codedGroups.filter((group) => !mappedGroupIds.has(group.id)),
    [codedGroups, mappedGroupIds],
  );

  const selectedClient = selectedClientId
    ? sortedClients.find((client) => client.id === selectedClientId) ?? null
    : null;
  const selectedGroup = selectedGroupId ? groupsById.get(selectedGroupId) ?? null : null;

  async function saveRoute(nextItems: RouteItem[]) {
    if (!selectedClientId) return;

    const previousItems = routeItems;
    setRouteItems(nextItems);
    setIsSavingRoute(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/cs/client-use-case-route", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: selectedClientId, items: nextItems }),
      });
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;

      if (!response.ok) {
        throw new Error(payload?.message || "No pudimos guardar el mapa del cliente.");
      }
    } catch (caughtError) {
      setRouteItems(previousItems);
      setErrorMessage(
        caughtError instanceof Error ? caughtError.message : "No pudimos guardar el mapa del cliente.",
      );
    } finally {
      setIsSavingRoute(false);
    }
  }

  function addToMap(groupId: string) {
    if (mappedGroupIds.has(groupId) || routeItems.length >= MAX_MAP_NODES) return;
    void saveRoute([...routeItems, { groupId, icon: DEFAULT_NODE_ICON }]);
  }

  function removeFromMap(groupId: string) {
    void saveRoute(routeItems.filter((item) => item.groupId !== groupId));
  }

  function toggleMap(groupId: string) {
    if (mappedGroupIds.has(groupId)) removeFromMap(groupId);
    else addToMap(groupId);
  }

  function setIconForGroup(groupId: string, icon: string) {
    void saveRoute(routeItems.map((item) => (item.groupId === groupId ? { ...item, icon } : item)));
  }

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
          Elige un cliente, explora la librería completa de casos de uso y arma su mapa personalizado con un
          ícono para cada caso.
        </p>

        <label className="mt-4 block max-w-md space-y-1.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#99acc2]">Cliente</span>
          <Select
            value={selectedClientId ?? ""}
            onChange={(event) => setSelectedClientId(event.target.value || null)}
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
          <p className="text-sm font-semibold text-slate-500">Selecciona un cliente para ver su mapa de casos.</p>
        </div>
      ) : (
        <main className="mt-6 min-w-0">
          <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
            <button
              type="button"
              onClick={() => setViewMode("builder")}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-bold transition",
                viewMode === "builder" ? "bg-[var(--accent)] text-white" : "text-slate-500 hover:text-slate-900",
              )}
            >
              <MapIcon className="h-4 w-4" />
              Mapa de {selectedClient.name}
            </button>
            <button
              type="button"
              onClick={() => setViewMode("library")}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-bold transition",
                viewMode === "library" ? "bg-[var(--accent)] text-white" : "text-slate-500 hover:text-slate-900",
              )}
            >
              <Library className="h-4 w-4" />
              Ver toda la librería
            </button>
          </div>

          {viewMode === "builder" ? (
            <UseCaseStarMap
              clientName={selectedClient.name}
              routeItems={routeItems}
              groupsById={groupsById}
              edges={edges}
              statusByGroupId={statusByGroupId}
              candidateGroups={candidateGroups}
              isSaving={isSavingRoute}
              selectedGroupId={selectedGroupId}
              onSelectGroup={setSelectedGroupId}
              onAdd={addToMap}
              onRemove={removeFromMap}
              onIconChange={setIconForGroup}
            />
          ) : (
            <UseCaseLibrary
              groups={codedGroups}
              sortedClusters={sortedClusters}
              clusterColorById={clusterColorById}
              clusterIdsByGroupId={clusterIdsByGroupId}
              linkedGroupIds={linkedGroupIds}
              statusByGroupId={statusByGroupId}
              mappedGroupIds={mappedGroupIds}
              edges={edges}
              selectedGroupId={selectedGroupId}
              onSelectGroup={setSelectedGroupId}
            />
          )}

          {errorMessage ? (
            <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
              {errorMessage}
            </p>
          ) : null}

          {selectedGroup ? (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6"
              onClick={() => setSelectedGroupId(null)}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="use-case-detail-title"
                className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-[20px] border border-slate-200 bg-white shadow-[0_28px_90px_rgba(15,23,42,0.28)]"
                onClick={(event) => event.stopPropagation()}
              >
                <UseCaseDetailPanel
                  categoriesById={categoriesById}
                  completedGroupIds={completedGroupIds}
                  edges={edges}
                  group={selectedGroup}
                  groupsById={groupsById}
                  isInMap={mappedGroupIds.has(selectedGroup.id)}
                  isSaving={isSavingRoute}
                  onClose={() => setSelectedGroupId(null)}
                  onToggleMap={() => toggleMap(selectedGroup.id)}
                  status={statusByGroupId.get(selectedGroup.id) ?? "untouched"}
                />
              </div>
            </div>
          ) : null}
        </main>
      )}
    </div>
  );
}
