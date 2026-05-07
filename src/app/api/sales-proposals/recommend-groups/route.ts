import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatUserError, isMissingSupabaseTable } from "@/lib/utils";

type RecommendationGroup = {
  id: string;
  name: string;
  description?: string;
  modalCategory: string;
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
  groups?: RecommendationGroup[];
};

function resolveClaudeMessagesUrl() {
  const rawBaseUrl = process.env.CLAUDE_API_BASE_URL?.trim() || "https://api.claudeapi.com";
  const normalized = rawBaseUrl.replace(/\/$/, "");

  return normalized.endsWith("/v1") ? `${normalized}/messages` : `${normalized}/v1/messages`;
}

function extractJsonPayload(text: string) {
  const fencedMatch = text.match(/```json\s*([\s\S]*?)```/i) ?? text.match(/```\s*([\s\S]*?)```/i);
  const candidate = fencedMatch?.[1] ?? text;

  return JSON.parse(candidate.trim()) as {
    summary?: string;
    recommendations?: Array<{
      group_id?: string;
      status?: string;
      reason?: string;
    }>;
  };
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
      '- Usa exactamente esta forma: {"summary":"texto","recommendations":[{"group_id":"uuid","status":"planned|backlog|executing","reason":"texto"}]}.',
      "- Solo puedes recomendar group_id que existan en el catalogo recibido.",
      "- No inventes ids, categorias ni tareas.",
      "- Prioriza grupos de Fundamentos/Fundamentales cuando sean necesarios para que el plan sea viable.",
      "- Devuelve entre 1 y 6 recomendaciones utiles.",
      "- Usa status planned para lo inmediato, backlog para lo posterior y executing solo si tiene sentido arrancar de inmediato.",
    ].join("\n");

    const userPayload = {
      start_date: body.startDate ?? null,
      portal_state: body.portalState ?? "new",
      selected_hubs: selectedHubs,
      commercial_context: body.context?.trim() || "",
      available_groups: groups.map((group) => ({
        id: group.id,
        name: group.name,
        description: group.description ?? "",
        modal_category: group.modalCategory,
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
        max_tokens: 1200,
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

    const rawResponse = (await claudeResponse.json()) as {
      error?: { message?: string };
      content?: Array<{ type?: string; text?: string }>;
    };

    if (!claudeResponse.ok) {
      throw new Error(rawResponse.error?.message || "Claude no pudo procesar la recomendacion.");
    }

    const responseText = (rawResponse.content ?? [])
      .filter((entry) => entry.type === "text" && entry.text)
      .map((entry) => entry.text)
      .join("\n")
      .trim();

    if (!responseText) {
      throw new Error("Claude no devolvio contenido util.");
    }

    const parsed = extractJsonPayload(responseText);
    const knownGroupIds = new Set(groups.map((group) => group.id));
    const recommendations = (parsed.recommendations ?? []).filter(
      (recommendation) =>
        recommendation.group_id &&
        knownGroupIds.has(recommendation.group_id) &&
        (
          recommendation.status === "planned" ||
          recommendation.status === "backlog" ||
          recommendation.status === "executing"
        ),
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
