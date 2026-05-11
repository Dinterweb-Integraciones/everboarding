import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatUserError } from "@/lib/utils";

type RouteContext = {
  params: Promise<{
    audience: string;
    slug: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { audience, slug } = await context.params;

  if (audience !== "client") {
    return NextResponse.json(
      { message: "Esta vista publica no permite crear iniciativas." },
      { status: 403 },
    );
  }

  try {
    const body = (await request.json()) as {
      title?: string;
      description?: string;
      catalogItemIds?: string[];
    };

    if (!body.title?.trim()) {
      return NextResponse.json(
        { message: "Escribe un titulo para registrar la solicitud." },
        { status: 400 },
      );
    }

    if (!body.catalogItemIds?.length) {
      return NextResponse.json(
        { message: "Selecciona al menos una tarea de la biblioteca." },
        { status: 400 },
      );
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("create_public_backlog_initiative", {
      p_slug: slug,
      p_title: body.title.trim(),
      p_description: body.description?.trim() || null,
      p_catalog_item_ids: body.catalogItemIds,
    });

    if (error || !data) {
      return NextResponse.json(
        {
          message: formatUserError(
            error,
            "No fue posible registrar la solicitud publica.",
          ),
        },
        { status: 400 },
      );
    }

    return NextResponse.json({
      ...data,
      labels: data.labels ?? [],
      subitems: [],
      logs: [],
      credits: 0,
      progressPercent: 0,
      selected_catalog_item_ids: body.catalogItemIds,
    });
  } catch (caughtError) {
    return NextResponse.json(
      {
        message: formatUserError(
          caughtError,
          "No fue posible registrar la solicitud publica.",
        ),
      },
      { status: 500 },
    );
  }
}
