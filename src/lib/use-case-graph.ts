import type { CreditCatalogGroup } from "@/lib/onboarding";
import { safeParseNumber } from "@/lib/utils";

export type RelationKind = "logical" | "previous" | "subsequent";

export type GraphEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  kind: RelationKind;
};

export type UnresolvedReference = {
  groupId: string;
  value: string;
  kind: RelationKind;
};

export type PositionedNode = {
  group: CreditCatalogGroup;
  x: number;
  y: number;
};

export const WITHOUT_CLUSTER = "__without_cluster__";
export const NODE_RADIUS = 25;
export const UNASSIGNED_COLOR = "#64748b";
export const CLUSTER_COLORS = [
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

export const relationConfig: Record<
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

export function normalizeReference(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/^[\s_-]*cu[\s:_-]*/i, "")
    .replace(/\s+/g, " ");
}

export function splitReferences(value: string | null) {
  if (!value?.trim()) return [];

  return [...new Set(value.split(/[;,\n]+/).map((item) => item.trim()).filter(Boolean))];
}

export function truncate(value: string, length: number) {
  return value.length > length ? `${value.slice(0, length - 1).trim()}…` : value;
}

export function wrapStarLabel(text: string, maxChars: number): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = "";
  words.forEach((word) => {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  });
  if (current) lines.push(current);
  if (lines.length > 2) {
    const kept = lines.slice(0, 2);
    kept[1] = `${kept[1].slice(0, Math.max(0, kept[1].length - 1))}…`;
    return kept;
  }
  return lines;
}

export function wrapNodeTitle(value: string) {
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

export function roundGraphCoordinate(value: number) {
  return Math.round(value * 100) / 100;
}

/** Deterministic per-id "randomness" so the star's irregularity stays stable across renders. */
export function hashSeed(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function jitterFor(id: string, salt: string, spread: number) {
  const seed = hashSeed(`${id}:${salt}`);
  return ((seed % 1000) / 1000 - 0.5) * 2 * spread;
}

export function getArrowPath(source: PositionedNode, target: PositionedNode) {
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

/** Resolves the real, catalog-defined relations for a set of use cases (no inferred/guessed links). */
export function buildUseCaseEdges(groups: CreditCatalogGroup[]) {
  const aliases = new Map<string, string>();
  groups.forEach((group) => {
    const code = normalizeReference(group.use_case_code ?? "");
    const name = normalizeReference(group.name);
    if (code) aliases.set(code, group.id);
    if (name) aliases.set(name, group.id);
  });

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
}

export type ClusterStarGroup = {
  id: string;
  label: string;
  color: string;
  groups: CreditCatalogGroup[];
};

export type ClusterStarHub = {
  id: string;
  label: string;
  color: string;
  x: number;
  y: number;
  memberCount: number;
};

export type ClusterStarSpoke = {
  hubId: string;
  groupId: string;
  color: string;
};

export const HUB_RADIUS = 40;

/** Node radius shrinks as a cluster grows so its star still fits on one ring. */
function starNodeRadius(memberCount: number) {
  if (memberCount <= 1) return 26;
  if (memberCount <= 6) return 22;
  if (memberCount <= 14) return 18;
  if (memberCount <= 26) return 15;
  return 12;
}

/** Ring radius grows with member count so nodes keep a roughly constant spacing. */
function starRingRadius(memberCount: number, nodeRadius: number) {
  if (memberCount <= 1) return HUB_RADIUS + nodeRadius + 22;
  const spacing = nodeRadius * 2.7;
  const circumferenceRadius = (memberCount * spacing) / (2 * Math.PI);
  return Math.max(nodeRadius * 3.4, circumferenceRadius);
}

const GOLDEN_ANGLE = 2.399963229728653;

/**
 * Lays out one star per cluster: a central hub with its member use cases scattered,
 * irregularly, around it on a single ring. Clusters themselves are scattered across
 * the canvas along a sunflower spiral so bigger stars don't collide with their
 * neighbors.
 */
export function layoutClusterStars(clusterGroups: ClusterStarGroup[]) {
  const prepared = clusterGroups
    .filter((cluster) => cluster.groups.length > 0)
    .map((cluster) => {
      const sortedMembers = [...cluster.groups].sort(
        (left, right) =>
          safeParseNumber(left.sort_order) - safeParseNumber(right.sort_order)
          || left.name.localeCompare(right.name, "es"),
      );
      const nodeRadius = starNodeRadius(sortedMembers.length);
      const ringRadius = starRingRadius(sortedMembers.length, nodeRadius);
      const extent = ringRadius + nodeRadius + 50;
      return { ...cluster, groups: sortedMembers, nodeRadius, ringRadius, extent };
    })
    .sort((left, right) => right.groups.length - left.groups.length);

  const averageExtent =
    prepared.reduce((sum, cluster) => sum + cluster.extent, 0) / Math.max(prepared.length, 1);
  const hubSpacing = Math.max(240, averageExtent * 1.35);

  const hubs: ClusterStarHub[] = [];
  const nodes: PositionedNode[] = [];
  const nodeRadiusById = new Map<string, number>();
  const spokes: ClusterStarSpoke[] = [];

  prepared.forEach((cluster, clusterIndex) => {
    const angle = clusterIndex * GOLDEN_ANGLE;
    const hubDistance = clusterIndex === 0 ? 0 : hubSpacing * Math.sqrt(clusterIndex);
    const hubX = Math.cos(angle) * hubDistance;
    const hubY = Math.sin(angle) * hubDistance;

    hubs.push({
      id: cluster.id,
      label: cluster.label,
      color: cluster.color,
      x: hubX,
      y: hubY,
      memberCount: cluster.groups.length,
    });

    cluster.groups.forEach((group, memberIndex) => {
      const baseAngleDeg = -90 + (360 / Math.max(cluster.groups.length, 1)) * memberIndex;
      const memberAngle = ((baseAngleDeg + jitterFor(group.id, "angle", 11)) * Math.PI) / 180;
      const jitteredRadius = cluster.ringRadius + jitterFor(group.id, "radius", cluster.ringRadius * 0.16);
      nodes.push({
        group,
        x: roundGraphCoordinate(hubX + Math.cos(memberAngle) * jitteredRadius),
        y: roundGraphCoordinate(hubY + Math.sin(memberAngle) * jitteredRadius),
      });
      nodeRadiusById.set(group.id, cluster.nodeRadius);
      spokes.push({ hubId: cluster.id, groupId: group.id, color: cluster.color });
    });
  });

  const PADDING = 140;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  hubs.forEach((hub) => {
    minX = Math.min(minX, hub.x - HUB_RADIUS - 30);
    maxX = Math.max(maxX, hub.x + HUB_RADIUS + 30);
    minY = Math.min(minY, hub.y - HUB_RADIUS - 30);
    maxY = Math.max(maxY, hub.y + HUB_RADIUS + 30);
  });
  nodes.forEach((node) => {
    const radius = nodeRadiusById.get(node.group.id) ?? 18;
    minX = Math.min(minX, node.x - radius - 60);
    maxX = Math.max(maxX, node.x + radius + 60);
    minY = Math.min(minY, node.y - radius - 10);
    maxY = Math.max(maxY, node.y + radius + 42);
  });

  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 400;
    maxY = 400;
  }

  const offsetX = PADDING - minX;
  const offsetY = PADDING - minY;

  hubs.forEach((hub) => {
    hub.x = roundGraphCoordinate(hub.x + offsetX);
    hub.y = roundGraphCoordinate(hub.y + offsetY);
  });
  nodes.forEach((node) => {
    node.x = roundGraphCoordinate(node.x + offsetX);
    node.y = roundGraphCoordinate(node.y + offsetY);
  });

  return {
    hubs,
    nodes,
    nodeRadiusById,
    spokes,
    width: Math.round(maxX - minX + PADDING * 2),
    height: Math.round(maxY - minY + PADDING * 2),
  };
}
