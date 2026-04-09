import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { slugify } from "@/lib/utils";

export async function POST(request: Request) {
  const { supabase, user } = await requireUser();
  const body = (await request.json()) as {
    name?: string;
    description?: string | null;
    slug?: string;
  };

  const name = body.name?.trim();
  const description = body.description?.trim() || null;
  const slug = body.slug?.trim() || `${slugify(name || "cliente")}-${Date.now().toString(36)}`;

  if (!name) {
    return NextResponse.json({ message: "El nombre es requerido." }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("create_client", {
    p_name: name,
    p_description: description,
    p_slug: slug,
  });

  if (error) {
    return NextResponse.json(
      { message: "No pudimos crear el cliente. Intenta de nuevo." },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ...data,
    owner_user_id: user.id,
  });
}

export async function PUT(request: Request) {
  const { supabase } = await requireUser();
  const body = (await request.json()) as {
    id?: string;
    name?: string;
    description?: string | null;
  };

  const id = body.id?.trim();
  const name = body.name?.trim();
  const description = body.description?.trim() || null;

  if (!id || !name) {
    return NextResponse.json({ message: "ID y nombre son requeridos." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("clients")
    .update({
      name,
      description,
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json(
      { message: "No pudimos actualizar el cliente. Intenta de nuevo." },
      { status: 400 },
    );
  }

  return NextResponse.json(data);
}

export async function DELETE(request: Request) {
  const { supabase } = await requireUser();
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ message: "ID requerido." }, { status: 400 });
  }

  const { error } = await supabase.from("clients").delete().eq("id", id);

  if (error) {
    return NextResponse.json(
      { message: "No pudimos eliminar el cliente. Intenta de nuevo." },
      { status: 400 },
    );
  }

  return NextResponse.json({ success: true });
}
