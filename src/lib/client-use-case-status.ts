import { findCatalogGroupForInitiative, type CreditCatalogGroup, type InitiativeStatus } from "@/lib/onboarding";

export type ClientUseCaseStatus = "completed" | "in_progress" | "evaluating";
export type ClientUseCaseDisplayStatus = ClientUseCaseStatus | "untouched";

export const CLIENT_USE_CASE_STATUS_LABELS: Record<ClientUseCaseDisplayStatus, string> = {
  completed: "Completado",
  in_progress: "En curso",
  evaluating: "En evaluación",
  untouched: "No tocado",
};

export const CLIENT_USE_CASE_STATUS_COLORS: Record<ClientUseCaseDisplayStatus, { fill: string; text: string }> = {
  completed: { fill: "#059669", text: "#ffffff" },
  in_progress: { fill: "#0284c7", text: "#ffffff" },
  evaluating: { fill: "#94a3b8", text: "#ffffff" },
  untouched: { fill: "#e2e8f0", text: "#334155" },
};

export type ClientUseCaseInitiative = {
  client_id: string;
  title: string;
  description: string | null;
  status: InitiativeStatus;
};

const STATUS_RANK: Record<ClientUseCaseStatus, number> = {
  completed: 3,
  in_progress: 2,
  evaluating: 1,
};

function toClientUseCaseStatus(status: InitiativeStatus): ClientUseCaseStatus {
  if (status === "completed") return "completed";
  if (status === "planned" || status === "executing") return "in_progress";
  return "evaluating";
}

// Un caso "no tocado" simplemente no aparece en el mapa devuelto.
export function computeGroupStatusForClient(
  initiatives: ClientUseCaseInitiative[],
  groups: Pick<CreditCatalogGroup, "id" | "name" | "description">[],
): Map<string, ClientUseCaseStatus> {
  const statusByGroupId = new Map<string, ClientUseCaseStatus>();

  initiatives.forEach((initiative) => {
    const matchedGroup = findCatalogGroupForInitiative(initiative, groups);
    if (!matchedGroup) return;

    const nextStatus = toClientUseCaseStatus(initiative.status);
    const currentStatus = statusByGroupId.get(matchedGroup.id);

    if (!currentStatus || STATUS_RANK[nextStatus] > STATUS_RANK[currentStatus]) {
      statusByGroupId.set(matchedGroup.id, nextStatus);
    }
  });

  return statusByGroupId;
}
