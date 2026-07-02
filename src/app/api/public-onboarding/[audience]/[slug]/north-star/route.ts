import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatUserError } from "@/lib/utils";
import type { Database } from "@/types/database";

type RouteContext = {
  params: Promise<{
    audience: string;
    slug: string;
  }>;
};

type OnboardingConfig = Database["public"]["Tables"]["onboarding_configs"]["Row"];

async function resolveClientConfig(slug: string) {
  const admin = createSupabaseAdminClient();
  const { data: snapshot, error: snapshotError } = await admin.rpc(
    "get_public_onboarding_snapshot" as never,
    {
      p_slug: slug,
    } as never,
  );
  const snapshotData = snapshot as { client?: { id?: string } } | null;
  const clientId = snapshotData?.client?.id ?? null;

  if (snapshotError || !clientId) {
    throw new Error(
      formatUserError(snapshotError, "No fue posible ubicar el onboarding publico."),
    );
  }

  const { data: config, error: configError } = await admin
    .from("onboarding_configs")
    .select("*")
    .eq("client_id", clientId)
    .single();

  if (configError || !config) {
    throw new Error(formatUserError(configError, "No fue posible cargar El Norte."));
  }

  return { admin, config: config as OnboardingConfig };
}

export async function POST(request: Request, context: RouteContext) {
  const { audience, slug } = await context.params;

  if (audience !== "client") {
    return NextResponse.json(
      { message: "El Norte solo esta disponible en la vista del cliente." },
      { status: 403 },
    );
  }

  try {
    const body = (await request.json()) as {
      action?: "client_approve" | "dismiss" | "confirm_fulfilled" | "reject_fulfilled";
    };
    const { admin, config } = await resolveClientConfig(slug);

    if (body.action === "dismiss") {
      if (config.north_star_status === "completed") {
        return NextResponse.json({ config });
      }

      if (config.north_star_dismissals_used >= 3) {
        return NextResponse.json(
          { message: "Ya se usaron los 3 cierres disponibles." },
          { status: 400 },
        );
      }

      const { data: updatedConfig, error } = await admin
        .from("onboarding_configs" as never)
        .update({
          north_star_dismissals_used: config.north_star_dismissals_used + 1,
        } as never)
        .eq("client_id", config.client_id)
        .select("*")
        .single();

      if (error || !updatedConfig) {
        throw new Error(formatUserError(error, "No fue posible cerrar temporalmente El Norte."));
      }

      return NextResponse.json({ config: updatedConfig });
    }

    if (body.action === "confirm_fulfilled" || body.action === "reject_fulfilled") {
      if (config.north_star_status !== "completed") {
        return NextResponse.json(
          { message: "El Norte debe estar validado antes de marcarlo como cumplido." },
          { status: 400 },
        );
      }

      const nextLifecycleStatus = body.action === "confirm_fulfilled" ? "fulfilled" : "active";
      const { data: latestHistory, error: latestHistoryError } = await admin
        .from("onboarding_north_star_history")
        .select("id")
        .eq("client_id", config.client_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestHistoryError) {
        throw new Error(formatUserError(latestHistoryError, "No fue posible cargar la version actual de El Norte."));
      }

      const latestHistoryId = (latestHistory as { id?: string } | null)?.id;

      if (latestHistoryId) {
        const { error: historyError } = await admin
          .from("onboarding_north_star_history" as never)
          .update({ north_star_lifecycle_status: nextLifecycleStatus } as never)
          .eq("id", latestHistoryId as never);

        if (historyError) {
          throw new Error(formatUserError(historyError, "No fue posible actualizar la version actual de El Norte."));
        }
      }

      const { data: updatedConfig, error } = await admin
        .from("onboarding_configs" as never)
        .update({ north_star_lifecycle_status: nextLifecycleStatus } as never)
        .eq("client_id", config.client_id)
        .select("*")
        .single();

      if (error || !updatedConfig) {
        throw new Error(formatUserError(error, "No fue posible actualizar El Norte."));
      }

      return NextResponse.json({ config: updatedConfig });
    }

    if (body.action !== "client_approve") {
      return NextResponse.json({ message: "Accion no valida." }, { status: 400 });
    }

    if (config.north_star_status !== "cs_preapproved") {
      return NextResponse.json(
        { message: "El Customer Success debe enviar El Norte antes de aprobarlo." },
        { status: 400 },
      );
    }

    if (!config.north_star_text?.trim()) {
      return NextResponse.json(
        { message: "El Norte no tiene texto para aprobar." },
        { status: 400 },
      );
    }

    const { data: updatedConfig, error } = await admin
        .from("onboarding_configs" as never)
        .update({
          north_star_status: "client_approved",
          north_star_client_approved_at: new Date().toISOString(),
        } as never)
      .eq("client_id", config.client_id)
      .select("*")
      .single();

    if (error || !updatedConfig) {
      throw new Error(formatUserError(error, "No fue posible aprobar El Norte."));
    }

    const { data: latestHistory, error: latestHistoryError } = await admin
      .from("onboarding_north_star_history")
      .select("id")
      .eq("client_id", config.client_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const latestHistoryId = (latestHistory as { id?: string } | null)?.id;

    if (!latestHistoryError && latestHistoryId) {
      await admin
        .from("onboarding_north_star_history" as never)
        .update({ north_star_status: "client_approved" } as never)
        .eq("id", latestHistoryId as never);
    }

    return NextResponse.json({ config: updatedConfig });
  } catch (caughtError) {
    return NextResponse.json(
      {
        message: formatUserError(caughtError, "No fue posible actualizar El Norte."),
      },
      { status: 500 },
    );
  }
}

export async function GET(_request: Request, context: RouteContext) {
  const { audience, slug } = await context.params;

  if (audience !== "client") {
    return NextResponse.json(
      { message: "El Norte solo esta disponible en la vista del cliente." },
      { status: 403 },
    );
  }

  try {
    const { config } = await resolveClientConfig(slug);

    return NextResponse.json({ config });
  } catch (caughtError) {
    return NextResponse.json(
      {
        message: formatUserError(caughtError, "No fue posible cargar El Norte."),
      },
      { status: 500 },
    );
  }
}
