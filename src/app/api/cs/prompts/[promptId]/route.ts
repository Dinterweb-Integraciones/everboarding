import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { formatUserError, isMissingSupabaseTable } from "@/lib/utils";

type PromptRouteProps = {
  params: Promise<{ promptId: string }>;
};

export async function PUT(request: Request, { params }: PromptRouteProps) {
  try {
    const { promptId } = await params;
    const { supabase } = await requireUser();
    const body = (await request.json()) as {
      prompt?: string;
    };

    const prompt = body.prompt?.trim();
    if (!prompt) {
      return NextResponse.json({ message: "El prompt es requerido." }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("managed_prompts")
      .update({
        prompt_text: prompt,
      })
      .eq("id", promptId)
      .select("*")
      .single();

    if (error) throw error;

    return NextResponse.json(data);
  } catch (caughtError) {
    return NextResponse.json(
      {
        message: isMissingSupabaseTable(caughtError, "managed_prompts")
          ? "La tabla de prompts aun no existe en Supabase. Ejecuta la migracion pendiente para poder editar prompts."
          : formatUserError(caughtError, "No pudimos actualizar el prompt."),
      },
      { status: 400 },
    );
  }
}

export async function DELETE(_: Request, { params }: PromptRouteProps) {
  try {
    const { promptId } = await params;
    const { supabase } = await requireUser();

    const { error } = await supabase.from("managed_prompts").delete().eq("id", promptId);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (caughtError) {
    return NextResponse.json(
      {
        message: isMissingSupabaseTable(caughtError, "managed_prompts")
          ? "La tabla de prompts aun no existe en Supabase. Ejecuta la migracion pendiente para poder eliminar prompts."
          : formatUserError(caughtError, "No pudimos eliminar el prompt."),
      },
      { status: 400 },
    );
  }
}
