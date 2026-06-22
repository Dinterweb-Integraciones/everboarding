import { NextResponse } from "next/server";

import { getSalesProposalBySlug } from "@/lib/public-prospect";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatUserError } from "@/lib/utils";

type KickoffContactRouteProps = {
  params: Promise<{
    audience: string;
    slug: string;
  }>;
};

function normalizeEmail(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(request: Request, { params }: KickoffContactRouteProps) {
  try {
    const { audience, slug } = await params;

    if (audience !== "prospect") {
      return NextResponse.json(
        { message: "Esta opcion solo esta disponible para prospectos." },
        { status: 400 },
      );
    }

    const body = (await request.json()) as {
      contactEmail?: string;
    };
    const contactEmail = normalizeEmail(body.contactEmail);

    if (!isValidEmail(contactEmail)) {
      return NextResponse.json(
        { message: "Ingresa un correo valido para coordinar la kickoff." },
        { status: 400 },
      );
    }

    const proposal = await getSalesProposalBySlug(slug);

    if (!proposal?.id) {
      return NextResponse.json(
        { message: "No encontramos la propuesta para guardar el contacto de kickoff." },
        { status: 404 },
      );
    }

    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("sales_proposals")
      .update(({
        kickoff_contact_email: contactEmail,
        updated_at: new Date().toISOString(),
      }) as never)
      .eq("id", proposal.id);

    if (error) {
      throw error;
    }

    return NextResponse.json({
      message: "Listo. Guardamos el correo para coordinar la kickoff.",
      contactEmail,
    });
  } catch (caughtError) {
    return NextResponse.json(
      {
        message: formatUserError(
          caughtError,
          "No pudimos guardar el correo para coordinar la kickoff.",
        ),
      },
      { status: 400 },
    );
  }
}
