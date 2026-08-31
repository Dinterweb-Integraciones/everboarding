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

export function layoutGraph(
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
