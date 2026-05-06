import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { formatUserError, isMissingSupabaseTable } from "@/lib/utils";

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = (await request.json()) as {
      prompt?: string;
    };

    const prompt = body.prompt?.trim();
    if (!prompt) {
      return NextResponse.json({ message: "El prompt es requerido." }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("managed_prompts")
      .upsert({
        singleton_key: "default",
        prompt_text: prompt,
        created_by_user_id: user.id,
      }, {
        onConflict: "singleton_key",
      })
      .select("*")
      .single();

    if (error) throw error;

    return NextResponse.json(data);
  } catch (caughtError) {
    return NextResponse.json(
      {
        message: isMissingSupabaseTable(caughtError, "managed_prompts")
          ? "La tabla de prompts aun no existe en Supabase. Ejecuta la migracion pendiente para poder guardar prompts."
          : formatUserError(caughtError, "No pudimos registrar el prompt."),
      },
      { status: 400 },
    );
  }
}

export async function DELETE() {
  try {
    const { supabase } = await requireUser();

    const { error } = await supabase
      .from("managed_prompts")
      .delete()
      .eq("singleton_key", "default");

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (caughtError) {
    return NextResponse.json(
      {
        message: isMissingSupabaseTable(caughtError, "managed_prompts")
          ? "La tabla de prompts aun no existe en Supabase. Ejecuta la migracion pendiente para poder eliminar el prompt."
          : formatUserError(caughtError, "No pudimos eliminar el prompt."),
      },
      { status: 400 },
    );
  }
}
