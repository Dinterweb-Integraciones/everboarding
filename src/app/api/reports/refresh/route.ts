import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { invalidateReportsCache } from "@/lib/reports-cache";

// Descarta la caché de /informes para que la siguiente carga consulte los datos actuales.
export async function POST() {
  const { platformProfile } = await requireUser("/informes");
  const platformRole = platformProfile?.platform_role ?? null;

  if (platformRole !== "admin" && platformRole !== "superadmin" && platformRole !== "csm") {
    return NextResponse.json({ message: "No tienes permiso para actualizar los informes." }, { status: 403 });
  }

  invalidateReportsCache();

  return NextResponse.json({ message: "Informes actualizados." });
}
