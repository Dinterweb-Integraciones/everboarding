import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
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

    const normalizedStatus =
      recommendation.status === "executing" ||
      recommendation.status === "planned" ||
      recommendation.status === "backlog"
        ? recommendation.status
        : null;

    if (!normalizedStatus) {
      return [];
    }

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

    const recommendations = buildPromptDrivenRecommendations(parsed, groups);

    if (!recommendations.length) {
      throw new Error("Claude no devolvio recomendaciones validas usando el catalogo enviado.");
    }

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
