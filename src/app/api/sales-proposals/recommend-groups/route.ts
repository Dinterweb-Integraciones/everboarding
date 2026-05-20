import { NextResponse } from "next/server";

import { isAllowedDinterwebUser } from "@/lib/auth-domain";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatUserError, isMissingSupabaseTable, safeParseNumber } from "@/lib/utils";

type RecommendationGroup = {
  id: string;
  name: string;
  description?: string;
  modalCategory: string;
  priorityStatus?: string;
  credits: number;
  tasks: Array<{
    id: string;
    label: string;
    category: string;
    credits: number;
  }>;
};

type RecommendationRequestBody = {
  startDate?: string;
  workspaceVariant?: "hubspot" | "dinterweb";
  selectedHubs?: string[];
  portalState?: "new" | "optimize";
  context?: string;
  contractedCredits?: number;
  currentPlanCredits?: number;
  remainingRecommendationCredits?: number;
  groups?: RecommendationGroup[];
};

type ClaudeRecommendation = {
  group_id?: string;
  id?: string;
  nombre?: string;
  name?: string;
  title?: string;
  modal_category?: string;
  category?: string;
  status?: string;
  reason?: string;
  start_date?: string;
  end_date?: string;
};

type ClaudeLegacyGroup = {
  id?: string;
  group_id?: string;
  nombre?: string;
  name?: string;
  descripcion?: string;
  description?: string;
  reason?: string;
  start_date?: string;
  end_date?: string;
};

type ClaudeParsedPayload = {
  summary?: string;
  recommendations?: ClaudeRecommendation[];
  planificado?: ClaudeLegacyGroup[];
  en_evaluacion?: ClaudeLegacyGroup[];
  error?: string | null;
};

type FinalRecommendation = {
  group_id: string;
  status: "planned" | "backlog" | "executing";
  reason: string;
  start_date?: string;
  end_date?: string;
};

function resolveClaudeMessagesUrl() {
  const rawBaseUrl = process.env.CLAUDE_API_BASE_URL?.trim() || "https://api.claudeapi.com";
  const normalized = rawBaseUrl.replace(/\/$/, "");

  return normalized.endsWith("/v1") ? `${normalized}/messages` : `${normalized}/v1/messages`;
}

function normalizeGroupLookupName(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/["'`]+/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLocaleLowerCase("es");
}

function coerceClaudeParsedPayload(value: unknown) {
  if (Array.isArray(value)) {
    return {
      recommendations: value,
    } as ClaudeParsedPayload;
  }

  if (value && typeof value === "object") {
    return value as ClaudeParsedPayload;
  }

  throw new Error("Claude no devolvio un objeto JSON reconocible.");
}

function extractJsonPayload(text: string) {
  const normalizedText = text.replace(/^\uFEFF/, "").trim();
  const fencedMatch =
    normalizedText.match(/```json\s*([\s\S]*?)```/i) ??
    normalizedText.match(/```\s*([\s\S]*?)```/i);
  const candidate = (fencedMatch?.[1] ?? normalizedText).trim();

  try {
    return coerceClaudeParsedPayload(JSON.parse(candidate));
  } catch {
    const balancedJsonValue = extractFirstBalancedJsonValue(candidate);
    if (!balancedJsonValue) {
      throw new Error("Claude no devolvio un objeto JSON reconocible.");
    }

    return coerceClaudeParsedPayload(JSON.parse(balancedJsonValue));
  }
}

function extractFirstBalancedJsonValue(text: string) {
  const objectStartIndex = text.indexOf("{");
  const arrayStartIndex = text.indexOf("[");
  const startIndex =
    objectStartIndex === -1
      ? arrayStartIndex
      : arrayStartIndex === -1
        ? objectStartIndex
        : Math.min(objectStartIndex, arrayStartIndex);

  if (startIndex === -1) {
    return null;
  }

  const openingCharacter = text[startIndex];
  const closingCharacter = openingCharacter === "[" ? "]" : "}";
  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const character = text[index];

    if (escaping) {
      escaping = false;
      continue;
    }

    if (character === "\\") {
      escaping = true;
      continue;
    }

    if (character === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (character === openingCharacter) {
      depth += 1;
      continue;
    }

    if (character === closingCharacter) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function extractClaudeTextPayload(rawBody: string) {
  const trimmedBody = rawBody.trim();
  if (!trimmedBody) {
    return "";
  }

  try {
    const parsed = JSON.parse(trimmedBody) as {
      content?: Array<{ type?: string; text?: string }>;
    };

    if (Array.isArray(parsed.content)) {
      return parsed.content
        .filter((entry) => entry.type === "text" && entry.text)
        .map((entry) => entry.text)
        .join("\n")
        .trim();
    }
  } catch {
    return trimmedBody;
  }

  return trimmedBody;
}

function extractClaudeErrorMessage(rawBody: string) {
  const trimmedBody = rawBody.trim();
  if (!trimmedBody) {
    return "Claude no pudo procesar la recomendacion.";
  }

  try {
    const parsed = JSON.parse(trimmedBody) as {
      error?: { message?: string };
      message?: string;
    };

    return parsed.error?.message || parsed.message || trimmedBody;
  } catch {
    return trimmedBody;
  }
}

function sanitizeRecommendationReason(reason: string | undefined, group: RecommendationGroup) {
  const cleaned = (reason ?? "")
    .replace(/["\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned) {
    return cleaned.slice(0, 140);
  }

  return `Prioridad para ${group.name}.`.slice(0, 140);
}

function normalizeRecommendationStatus(
  status: string | undefined,
): FinalRecommendation["status"] | null {
  const normalized = normalizeGroupLookupName(status ?? "");

  if (!normalized) {
    return null;
  }

  if (
    [
      "executing",
      "execution",
      "in progress",
      "in_progress",
      "implementing",
      "ejecutando",
      "en progreso",
      "en curso",
      "implementacion",
      "implementando",
    ].includes(normalized)
  ) {
    return "executing";
  }

  if (["planned", "planning", "planificado", "planeado", "por ejecutar"].includes(normalized)) {
    return "planned";
  }

  if (["backlog", "evaluacion", "en evaluacion", "pendiente", "later"].includes(normalized)) {
    return "backlog";
  }

  return null;
}

function findMatchingGroup(
  recommendation: ClaudeRecommendation | ClaudeLegacyGroup,
  groups: RecommendationGroup[],
  usedGroupIds = new Set<string>(),
) {
  const candidateIds = [recommendation.group_id, recommendation.id].filter(Boolean) as string[];
  const candidateNames = [
    "name" in recommendation ? recommendation.name : undefined,
    "nombre" in recommendation ? recommendation.nombre : undefined,
    "title" in recommendation ? recommendation.title : undefined,
  ]
    .filter(Boolean)
    .map((value) => normalizeGroupLookupName(value as string));
  const candidateCategories = [
    "modal_category" in recommendation ? recommendation.modal_category : undefined,
    "category" in recommendation ? recommendation.category : undefined,
  ]
    .filter(Boolean)
    .map((value) => normalizeGroupLookupName(value as string));

  for (const groupId of candidateIds) {
    const matchedGroup = groups.find((group) => group.id === groupId && !usedGroupIds.has(group.id));
    if (matchedGroup) {
      return matchedGroup;
    }
  }

  for (const candidateName of candidateNames) {
    const exactMatch = groups.find(
      (group) => !usedGroupIds.has(group.id) && normalizeGroupLookupName(group.name) === candidateName,
    );
    if (exactMatch) {
      return exactMatch;
    }
  }

  for (const candidateName of candidateNames) {
    const fuzzyMatch = groups.find((group) => {
      if (usedGroupIds.has(group.id)) {
        return false;
      }

      const normalizedGroupName = normalizeGroupLookupName(group.name);
      return (
        normalizedGroupName.includes(candidateName) || candidateName.includes(normalizedGroupName)
      );
    });

    if (fuzzyMatch) {
      return fuzzyMatch;
    }
  }

  for (const candidateCategory of candidateCategories) {
    const categoryMatch = groups.find(
      (group) =>
        !usedGroupIds.has(group.id) &&
        normalizeGroupLookupName(group.modalCategory) === candidateCategory,
    );
    if (categoryMatch) {
      return categoryMatch;
    }
  }

  return null;
}

function mapLegacyGroupsToRecommendations(
  entries: ClaudeLegacyGroup[] | undefined,
  status: "planned" | "backlog",
  groups: RecommendationGroup[],
): ClaudeRecommendation[] {
  if (!Array.isArray(entries)) {
    return [];
  }
  const usedGroupIds = new Set<string>();

  return entries.flatMap((entry) => {
    const matchedGroup = findMatchingGroup(entry, groups, usedGroupIds);
    if (!matchedGroup) {
      return [];
    }

    usedGroupIds.add(matchedGroup.id);

    return [
      {
        group_id: matchedGroup.id,
        status,
        reason: entry.reason,
        start_date: entry.start_date,
        end_date: entry.end_date,
      },
    ];
  });
}

function normalizeClaudeRecommendations(parsed: ClaudeParsedPayload, groups: RecommendationGroup[]) {
  const usedDirectGroupIds = new Set<string>();
  const directRecommendations = (Array.isArray(parsed.recommendations) ? parsed.recommendations : []).flatMap(
    (recommendation) => {
      const matchedGroup = findMatchingGroup(recommendation, groups, usedDirectGroupIds);
      if (!matchedGroup) {
        return [];
      }

      usedDirectGroupIds.add(matchedGroup.id);

      return [
        {
          ...recommendation,
          group_id: matchedGroup.id,
        },
      ];
    },
  );
  const plannedRecommendations = mapLegacyGroupsToRecommendations(parsed.planificado, "planned", groups);
  const backlogRecommendations = mapLegacyGroupsToRecommendations(parsed.en_evaluacion, "backlog", groups);
  const seenGroupIds = new Set<string>();

  return [...directRecommendations, ...plannedRecommendations, ...backlogRecommendations].filter(
    (recommendation) => {
      if (!recommendation.group_id || seenGroupIds.has(recommendation.group_id)) {
        return false;
      }

      seenGroupIds.add(recommendation.group_id);
      return true;
    },
  );
}

function buildPromptDrivenRecommendations(parsed: ClaudeParsedPayload, groups: RecommendationGroup[]) {
  const groupsById = new Map(groups.map((group) => [group.id, group]));

  return normalizeClaudeRecommendations(parsed, groups).flatMap<FinalRecommendation>((recommendation) => {
    if (!recommendation.group_id) {
      return [];
    }

    const group = groupsById.get(recommendation.group_id);
    if (!group) {
      return [];
    }

    const normalizedStatus = normalizeRecommendationStatus(recommendation.status) ?? "planned";

    const normalizedRecommendation: FinalRecommendation = {
      group_id: recommendation.group_id,
      status: normalizedStatus,
      reason: sanitizeRecommendationReason(recommendation.reason, group),
    };

    if (normalizedStatus !== "backlog") {
      if (recommendation.start_date) {
        normalizedRecommendation.start_date = recommendation.start_date;
      }

      if (recommendation.end_date) {
        normalizedRecommendation.end_date = recommendation.end_date;
      }
    }

    return [normalizedRecommendation];
  });
}

function fitRecommendationsToCreditBudget(
  recommendations: FinalRecommendation[],
  groups: RecommendationGroup[],
  creditBudget: number,
) {
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  let usedCredits = 0;

  return recommendations.filter((recommendation) => {
    const group = groupsById.get(recommendation.group_id);
    if (!group) {
      return false;
    }

    const groupCredits = Math.max(0, safeParseNumber(group.credits));
    if (groupCredits === 0) {
      return true;
    }

    if (usedCredits + groupCredits > creditBudget) {
      return false;
    }

    usedCredits += groupCredits;
    return true;
  });
}

function buildDefaultRecommendations(
  groups: RecommendationGroup[],
  selectedHubs: string[],
  portalState: RecommendationRequestBody["portalState"],
  creditBudget: number,
) {
  const recommendations: FinalRecommendation[] = [];
  const usedGroupIds = new Set<string>();

  const findCategoryGroups = (category: string) =>
    groups.filter(
      (group) => normalizeGroupLookupName(group.modalCategory) === normalizeGroupLookupName(category),
    );

  const pushGroup = (group: RecommendationGroup, status: FinalRecommendation["status"]) => {
    if (usedGroupIds.has(group.id)) {
      return;
    }

    usedGroupIds.add(group.id);
    recommendations.push({
      group_id: group.id,
      status,
      reason: sanitizeRecommendationReason(undefined, group),
    });
  };

  findCategoryGroups("Fundamentales")
    .slice(0, 2)
    .forEach((group) => {
      pushGroup(group, "planned");
    });

  selectedHubs.forEach((hub, index) => {
    const categoryGroups = findCategoryGroups(hub);
    const preferredCount = portalState === "optimize" ? (index === 0 ? 3 : 2) : 2;

    categoryGroups.slice(0, preferredCount).forEach((group, itemIndex) => {
      pushGroup(group, index === 0 && itemIndex < 2 ? "planned" : "backlog");
    });
  });

  const budgetAwareRecommendations = fitRecommendationsToCreditBudget(recommendations, groups, creditBudget);
  return budgetAwareRecommendations.length ? budgetAwareRecommendations : recommendations.slice(0, 3);
}

export async function POST(request: Request) {
  try {
    if (!process.env.CLAUDE_API_KEY) {
      return NextResponse.json(
        { message: "Falta configurar CLAUDE_API_KEY en el servidor." },
        { status: 400 },
      );
    }

    const body = (await request.json()) as RecommendationRequestBody;

    if (body.workspaceVariant === "dinterweb") {
      const supabase = await createSupabaseServerClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user || !isAllowedDinterwebUser(user)) {
        return NextResponse.json(
          { message: "Necesitas iniciar sesion con tu correo de Dinterweb." },
          { status: 401 },
        );
      }
    }

    const selectedHubs = Array.isArray(body.selectedHubs)
      ? body.selectedHubs.map((hub) => hub.trim()).filter(Boolean)
      : [];
    const groups = Array.isArray(body.groups)
      ? body.groups.filter((group) => group?.id && group?.name && group?.modalCategory)
      : [];

    if (!selectedHubs.length) {
      return NextResponse.json(
        { message: "Selecciona al menos un area de HubSpot antes de pedir recomendaciones." },
        { status: 400 },
      );
    }

    if (!groups.length) {
      return NextResponse.json(
        { message: "No encontramos grupos del catalogo para recomendar." },
        { status: 400 },
      );
    }

    const contractedCredits = Math.max(0, safeParseNumber(body.contractedCredits));
    const currentPlanCredits = Math.max(0, safeParseNumber(body.currentPlanCredits));
    const remainingRecommendationCredits = Math.max(
      0,
      safeParseNumber(body.remainingRecommendationCredits || contractedCredits - currentPlanCredits),
    );

    const admin = createSupabaseAdminClient();
    const { data, error: promptError } = await admin
      .from("managed_prompts")
      .select("prompt_text")
      .eq("singleton_key", "default")
      .maybeSingle();
    const managedPrompt = data as { prompt_text: string } | null;

    if (promptError) {
      return NextResponse.json(
        {
          message: isMissingSupabaseTable(promptError, "managed_prompts")
            ? "La tabla managed_prompts aun no existe en Supabase."
            : formatUserError(promptError, "No pudimos leer el prompt administrable."),
        },
        { status: 400 },
      );
    }

    const promptText = managedPrompt?.prompt_text?.trim();
    if (!promptText) {
      return NextResponse.json(
        { message: "No hay un prompt configurado en CS > Prompts para generar recomendaciones inteligentes." },
        { status: 400 },
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180000);

    const userPayload = {
      start_date: body.startDate ?? null,
      portal_state: body.portalState ?? "new",
      selected_hubs: selectedHubs,
      total_contracted_credits: contractedCredits,
      current_plan_credits: currentPlanCredits,
      remaining_recommendation_credits: remainingRecommendationCredits,
      commercial_context: body.context?.trim() || "",
      available_groups: groups.map((group) => ({
        id: group.id,
        name: group.name,
        description: group.description ?? "",
        modal_category: group.modalCategory,
        priority_status: group.priorityStatus ?? "normal",
        credits: group.credits,
        tasks: group.tasks.map((task) => ({
          id: task.id,
          label: task.label,
          category: task.category,
          credits: task.credits,
        })),
      })),
    };

    const claudeResponse = await fetch(resolveClaudeMessagesUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.CLAUDE_API_MODEL || "claude-sonnet-4-6",
        max_tokens: 1400,
        temperature: 0.2,
        system: promptText,
        messages: [
          {
            role: "user",
            content: JSON.stringify(userPayload, null, 2),
          },
        ],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const rawClaudeBody = await claudeResponse.text();

    if (!claudeResponse.ok) {
      throw new Error(extractClaudeErrorMessage(rawClaudeBody));
    }

    const responseText = extractClaudeTextPayload(rawClaudeBody);

    if (!responseText) {
      throw new Error("Claude no devolvio contenido util.");
    }

    let parsed: ClaudeParsedPayload;
    let fallbackReason: string | undefined;

    try {
      parsed = extractJsonPayload(responseText);
    } catch (parseError) {
      console.error("sales_wizard_claude_payload_invalid", {
        error: parseError instanceof Error ? parseError.message : String(parseError),
        responseTextPreview: responseText.slice(0, 2000),
        rawClaudeBodyPreview: rawClaudeBody.slice(0, 2000),
      });
      parsed = {};
      fallbackReason = "claude_invalid_json";
    }

    const promptDrivenRecommendations = buildPromptDrivenRecommendations(parsed, groups);
    const recommendations = promptDrivenRecommendations.length
      ? promptDrivenRecommendations
      : buildDefaultRecommendations(groups, selectedHubs, body.portalState, remainingRecommendationCredits);

    if (!promptDrivenRecommendations.length && !fallbackReason) {
      console.warn("sales_wizard_claude_recommendations_fallback", {
        summary: parsed.summary ?? "",
        parsedRecommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.length : 0,
        parsedPlanificado: Array.isArray(parsed.planificado) ? parsed.planificado.length : 0,
        parsedEnEvaluacion: Array.isArray(parsed.en_evaluacion) ? parsed.en_evaluacion.length : 0,
      });
      fallbackReason = "claude_empty_recommendations";
    }

    return NextResponse.json({
      summary: parsed.summary ?? "",
      recommendations,
      fallbackReason,
    });
  } catch (caughtError) {
    return NextResponse.json(
      {
        message: formatUserError(
          caughtError,
          "No pudimos generar recomendaciones inteligentes para la guia de activacion.",
        ),
      },
      { status: 400 },
    );
  }
}
