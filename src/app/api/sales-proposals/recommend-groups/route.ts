import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatUserError, isMissingSupabaseTable, safeParseNumber, toIsoDate } from "@/lib/utils";

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
};

type ClaudeParsedPayload = {
  summary?: string;
  recommendations?: ClaudeRecommendation[];
  planificado?: ClaudeLegacyGroup[];
  en_evaluacion?: ClaudeLegacyGroup[];
  error?: string | null;
};

type RankedRecommendation = {
  group_id: string;
  reason: string;
  status?: string;
};

type FinalRecommendation = {
  group_id: string;
  status: "planned" | "backlog" | "executing";
  reason: string;
  start_date?: string;
  end_date?: string;
};

const TARGET_RECOMMENDATION_COUNT = 11;
const MIN_PLANNED_BUDGET_RATIO = 0.95;

function resolveClaudeMessagesUrl() {
  const rawBaseUrl = process.env.CLAUDE_API_BASE_URL?.trim() || "https://api.claudeapi.com";
  const normalized = rawBaseUrl.replace(/\/$/, "");

  return normalized.endsWith("/v1") ? `${normalized}/messages` : `${normalized}/v1/messages`;
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeGroupLookupName(name: string) {
  return name.trim().toLocaleLowerCase("es");
}

function extractJsonPayload(text: string) {
  const normalizedText = text.replace(/^\uFEFF/, "").trim();
  const fencedMatch =
    normalizedText.match(/```json\s*([\s\S]*?)```/i) ??
    normalizedText.match(/```\s*([\s\S]*?)```/i);
  const candidate = (fencedMatch?.[1] ?? normalizedText).trim();

  try {
    return JSON.parse(candidate) as ClaudeParsedPayload;
  } catch {
    const balancedObject = extractFirstBalancedJsonObject(candidate);
    if (!balancedObject) {
      throw new Error("Claude no devolvio un objeto JSON reconocible.");
    }

    return JSON.parse(balancedObject) as ClaudeParsedPayload;
  }
}

function extractFirstBalancedJsonObject(text: string) {
  const startIndex = text.indexOf("{");
  if (startIndex === -1) {
    return null;
  }

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

    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character === "}") {
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

function buildGroupSearchText(group: RecommendationGroup) {
  return normalizeText([group.modalCategory, group.name, group.description ?? ""].join(" "));
}

function isFundamentalGroup(group: RecommendationGroup) {
  const searchText = buildGroupSearchText(group);
  return (
    searchText.includes("fundamental") ||
    searchText.includes("fundamento") ||
    searchText.includes("setup") ||
    searchText.includes("configuracion inicial") ||
    normalizeText(group.priorityStatus) === "prioritario"
  );
}

function isKickoffGroup(group: RecommendationGroup) {
  const searchText = buildGroupSearchText(group);
  return searchText.includes("kickoff") || searchText.includes("kick off");
}

function getGroupHubRank(group: RecommendationGroup, selectedHubs: string[]) {
  const searchText = buildGroupSearchText(group);

  for (let index = 0; index < selectedHubs.length; index += 1) {
    if (searchText.includes(normalizeText(selectedHubs[index]))) {
      return index;
    }
  }

  return Number.MAX_SAFE_INTEGER;
}

function buildContextTerms(context: string) {
  return Array.from(
    new Set(
      normalizeText(context)
        .split(/[^a-z0-9]+/)
        .filter((term) => term.length >= 4),
    ),
  ).slice(0, 20);
}

function getGroupContextScore(group: RecommendationGroup, contextTerms: string[]) {
  if (!contextTerms.length) {
    return 0;
  }

  const searchText = buildGroupSearchText(group);
  return contextTerms.reduce((score, term) => score + (searchText.includes(term) ? 1 : 0), 0);
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

function mapLegacyGroupsToRecommendations(
  entries: ClaudeLegacyGroup[] | undefined,
  status: "planned" | "backlog",
  groups: RecommendationGroup[],
) {
  if (!Array.isArray(entries)) {
    return [] as ClaudeRecommendation[];
  }

  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const groupsByName = new Map(groups.map((group) => [normalizeGroupLookupName(group.name), group]));

  return entries.flatMap((entry) => {
    const groupId = entry.group_id || entry.id;
    const namedGroup = entry.nombre || entry.name;

    if (groupId && groupsById.has(groupId)) {
      return [{ group_id: groupId, status, reason: entry.reason }];
    }

    if (namedGroup) {
      const matchedGroup = groupsByName.get(normalizeGroupLookupName(namedGroup));
      if (matchedGroup) {
        return [{ group_id: matchedGroup.id, status, reason: entry.reason }];
      }
    }

    return [];
  });
}

function normalizeClaudeRecommendations(parsed: ClaudeParsedPayload, groups: RecommendationGroup[]) {
  const directRecommendations = Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
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

function buildFallbackRankedRecommendations(
  groups: RecommendationGroup[],
  selectedHubs: string[],
  portalState: "new" | "optimize",
  commercialContext: string,
  excludedGroupIds: Set<string>,
) {
  const contextTerms = buildContextTerms(commercialContext);

  return groups
    .filter((group) => !excludedGroupIds.has(group.id))
    .sort((left, right) => {
      const leftHubRank = getGroupHubRank(left, selectedHubs);
      const rightHubRank = getGroupHubRank(right, selectedHubs);
      const leftFundamentalRank = portalState === "new" && isFundamentalGroup(left) ? 0 : 1;
      const rightFundamentalRank = portalState === "new" && isFundamentalGroup(right) ? 0 : 1;
      const leftContextScore = getGroupContextScore(left, contextTerms);
      const rightContextScore = getGroupContextScore(right, contextTerms);
      const leftPriorityRank = normalizeText(left.priorityStatus) === "prioritario" ? 0 : 1;
      const rightPriorityRank = normalizeText(right.priorityStatus) === "prioritario" ? 0 : 1;

      return leftFundamentalRank - rightFundamentalRank
        || leftHubRank - rightHubRank
        || rightContextScore - leftContextScore
        || leftPriorityRank - rightPriorityRank
        || safeParseNumber(left.credits) - safeParseNumber(right.credits)
        || left.name.localeCompare(right.name, "es");
    })
    .map((group) => ({
      group_id: group.id,
      reason: sanitizeRecommendationReason(undefined, group),
      status: "planned",
    } satisfies RankedRecommendation));
}

function buildRankedRecommendations(
  parsed: ClaudeParsedPayload,
  groups: RecommendationGroup[],
  selectedHubs: string[],
  portalState: "new" | "optimize",
  commercialContext: string,
) {
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const targetCount = Math.min(TARGET_RECOMMENDATION_COUNT, groups.length);
  const ranked: RankedRecommendation[] = [];
  const seenGroupIds = new Set<string>();

  normalizeClaudeRecommendations(parsed, groups).forEach((recommendation) => {
    if (!recommendation.group_id || seenGroupIds.has(recommendation.group_id)) {
      return;
    }

    const group = groupsById.get(recommendation.group_id);
    if (!group) {
      return;
    }

    ranked.push({
      group_id: recommendation.group_id,
      reason: sanitizeRecommendationReason(recommendation.reason, group),
      status: recommendation.status,
    });
    seenGroupIds.add(recommendation.group_id);
  });

  if (ranked.length < targetCount) {
    buildFallbackRankedRecommendations(
      groups,
      selectedHubs,
      portalState,
      commercialContext,
      seenGroupIds,
    ).forEach((recommendation) => {
      if (ranked.length >= targetCount || seenGroupIds.has(recommendation.group_id)) {
        return;
      }

      ranked.push(recommendation);
      seenGroupIds.add(recommendation.group_id);
    });
  }

  return ranked.slice(0, targetCount);
}

function parseCalendarDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function addCalendarDays(value: Date, amount: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + amount);
  return next;
}

function isWeekend(value: Date) {
  return value.getDay() === 0 || value.getDay() === 6;
}

function moveToBusinessDay(value: Date) {
  let cursor = new Date(value);

  while (isWeekend(cursor)) {
    cursor = addCalendarDays(cursor, 1);
  }

  return cursor;
}

function addBusinessDays(value: Date, amount: number) {
  let cursor = moveToBusinessDay(value);
  let remaining = amount;

  while (remaining > 0) {
    cursor = addCalendarDays(cursor, 1);
    if (!isWeekend(cursor)) {
      remaining -= 1;
    }
  }

  return cursor;
}

function nextMonday(value: Date, includeCurrent = false) {
  let cursor = moveToBusinessDay(value);

  while (cursor.getDay() !== 1 || (!includeCurrent && cursor.getTime() === value.getTime())) {
    cursor = addCalendarDays(cursor, 1);
    cursor = moveToBusinessDay(cursor);
    includeCurrent = true;
  }

  return cursor;
}

function buildPlannedSelectionMask(
  rankedRecommendations: RankedRecommendation[],
  groups: RecommendationGroup[],
  creditBudget: number,
) {
  if (creditBudget <= 0 || !rankedRecommendations.length) {
    return 0;
  }

  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const targetCredits = creditBudget * MIN_PLANNED_BUDGET_RATIO;
  let bestMask = 0;
  let bestCredits = 0;
  let bestMeetsTarget = false;
  let bestPriorityScore = Number.NEGATIVE_INFINITY;

  for (let mask = 1; mask < (1 << rankedRecommendations.length); mask += 1) {
    let totalCredits = 0;
    let priorityScore = 0;
    let isValid = true;

    for (let index = 0; index < rankedRecommendations.length; index += 1) {
      if ((mask & (1 << index)) === 0) {
        continue;
      }

      const group = groupsById.get(rankedRecommendations[index].group_id);
      if (!group) {
        isValid = false;
        break;
      }

      totalCredits += Math.max(0, safeParseNumber(group.credits));
      if (totalCredits > creditBudget) {
        isValid = false;
        break;
      }

      priorityScore += rankedRecommendations.length - index;
    }

    if (!isValid) {
      continue;
    }

    const meetsTarget = totalCredits >= targetCredits;
    if (
      (meetsTarget && !bestMeetsTarget) ||
      (meetsTarget === bestMeetsTarget && totalCredits > bestCredits) ||
      (
        meetsTarget === bestMeetsTarget &&
        totalCredits === bestCredits &&
        priorityScore > bestPriorityScore
      )
    ) {
      bestMask = mask;
      bestCredits = totalCredits;
      bestMeetsTarget = meetsTarget;
      bestPriorityScore = priorityScore;
    }
  }

  return bestMask;
}

function schedulePlannedRecommendations(
  plannedRecommendations: RankedRecommendation[],
  groups: RecommendationGroup[],
  startDate: string | undefined,
) {
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const datesByGroupId = new Map<string, {
    start_date: string;
    end_date: string;
    status: "planned" | "executing";
  }>();

  if (!plannedRecommendations.length) {
    return datesByGroupId;
  }

  const planningStart = moveToBusinessDay(parseCalendarDate(startDate || toIsoDate()));
  const kickoffIndex = plannedRecommendations.findIndex((recommendation) => {
    const group = groupsById.get(recommendation.group_id);
    return group ? isKickoffGroup(group) : false;
  });
  const remainingRecommendations = [...plannedRecommendations];
  let weeklyCursor = nextMonday(planningStart, planningStart.getDay() === 1);

  if (kickoffIndex !== -1) {
    const [kickoffRecommendation] = remainingRecommendations.splice(kickoffIndex, 1);
    const kickoffEndDate = addBusinessDays(planningStart, 4);

    datesByGroupId.set(kickoffRecommendation.group_id, {
      start_date: toIsoDate(planningStart),
      end_date: toIsoDate(kickoffEndDate),
      status: "executing",
    });

    weeklyCursor = nextMonday(addCalendarDays(kickoffEndDate, 1), true);
  }

  for (let index = 0; index < remainingRecommendations.length; index += 2) {
    const weekMonday = nextMonday(weeklyCursor, true);
    const primaryRecommendation = remainingRecommendations[index];
    const secondaryRecommendation = remainingRecommendations[index + 1];

    datesByGroupId.set(primaryRecommendation.group_id, {
      start_date: toIsoDate(weekMonday),
      end_date: toIsoDate(addBusinessDays(weekMonday, 4)),
      status: primaryRecommendation.status === "executing" ? "executing" : "planned",
    });

    if (secondaryRecommendation) {
      const weekWednesday = addBusinessDays(weekMonday, 2);

      datesByGroupId.set(secondaryRecommendation.group_id, {
        start_date: toIsoDate(weekWednesday),
        end_date: toIsoDate(addBusinessDays(weekWednesday, 4)),
        status: secondaryRecommendation.status === "executing" ? "executing" : "planned",
      });
    }

    weeklyCursor = addCalendarDays(weekMonday, 7);
  }

  return datesByGroupId;
}

function buildFinalRecommendations(
  rankedRecommendations: RankedRecommendation[],
  groups: RecommendationGroup[],
  creditBudget: number,
  startDate: string | undefined,
) {
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const selectionMask = buildPlannedSelectionMask(rankedRecommendations, groups, creditBudget);
  const plannedRecommendations = rankedRecommendations.filter((_, index) => (selectionMask & (1 << index)) !== 0);
  const plannedGroupIds = new Set(plannedRecommendations.map((recommendation) => recommendation.group_id));
  const datesByGroupId = schedulePlannedRecommendations(plannedRecommendations, groups, startDate);

  return rankedRecommendations.flatMap((recommendation) => {
    const group = groupsById.get(recommendation.group_id);
    if (!group) {
      return [];
    }

    if (!plannedGroupIds.has(recommendation.group_id)) {
      return [{
        group_id: recommendation.group_id,
        status: "backlog",
        reason: sanitizeRecommendationReason(recommendation.reason, group),
      } satisfies FinalRecommendation];
    }

    const scheduled = datesByGroupId.get(recommendation.group_id);

    return [{
      group_id: recommendation.group_id,
      status: scheduled?.status ?? "planned",
      reason: sanitizeRecommendationReason(recommendation.reason, group),
      start_date: scheduled?.start_date,
      end_date: scheduled?.end_date,
    } satisfies FinalRecommendation];
  });
}

export async function POST(request: Request) {
  try {
    await requireUser();

    if (!process.env.CLAUDE_API_KEY) {
      return NextResponse.json(
        { message: "Falta configurar CLAUDE_API_KEY en el servidor." },
        { status: 400 },
      );
    }

    const body = (await request.json()) as RecommendationRequestBody;
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
    const timeout = setTimeout(() => controller.abort(), 30000);

    const systemPrompt = [
      promptText,
      "",
      "Reglas obligatorias del sistema:",
      "- Responde exclusivamente JSON valido, sin explicaciones fuera del JSON.",
      '- Usa exactamente esta forma: {"summary":"texto","recommendations":[{"group_id":"uuid","status":"planned","reason":"texto"}]}.',
      "- Solo puedes recomendar group_id que existan en el catalogo recibido.",
      "- No inventes ids, categorias ni tareas.",
      "- Tu unica tarea es devolver un ranking priorizado de grupos; el backend decidira presupuesto, status y fechas.",
      `- Si available_groups tiene ${TARGET_RECOMMENDATION_COUNT} o mas grupos, devuelve exactamente ${TARGET_RECOMMENDATION_COUNT} recommendations.`,
      `- Si available_groups tiene menos de ${TARGET_RECOMMENDATION_COUNT} grupos, devuelve todos los disponibles sin repetir.`,
      "- Usa status planned como placeholder en todas las recommendations.",
      "- Prioriza grupos de Fundamentos/Fundamentales cuando portal_state sea new y sean necesarios para que el plan sea viable.",
      "- Ordena de mayor prioridad a menor prioridad segun selected_hubs, commercial_context y madurez del portal.",
      "- No calcules presupuesto ni clasifiques backlog.",
      "- No asignes start_date ni end_date.",
      "- reason debe ser breve, util y de maximo 140 caracteres.",
    ].join("\n");

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
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: `Analiza el siguiente contexto y recomienda grupos del catalogo:\n${JSON.stringify(userPayload, null, 2)}`,
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

    try {
      parsed = extractJsonPayload(responseText);
    } catch (parseError) {
      console.error("sales_wizard_claude_payload_invalid", {
        error: parseError instanceof Error ? parseError.message : String(parseError),
        responseTextPreview: responseText.slice(0, 2000),
        rawClaudeBodyPreview: rawClaudeBody.slice(0, 2000),
      });
      throw parseError;
    }

    const rankedRecommendations = buildRankedRecommendations(
      parsed,
      groups,
      selectedHubs,
      body.portalState ?? "new",
      body.context?.trim() || "",
    );
    const recommendations = buildFinalRecommendations(
      rankedRecommendations,
      groups,
      remainingRecommendationCredits,
      body.startDate,
    );

    return NextResponse.json({
      summary: parsed.summary ?? "",
      recommendations,
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
