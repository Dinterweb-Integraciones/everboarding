import { redirect } from "next/navigation";

import { ReportsPanel } from "@/components/reports/reports-panel";
import { requireUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Views } from "@/types/database";

export default async function ReportsPage() {
  const { platformProfile } = await requireUser("/informes");
  const platformRole = platformProfile?.platform_role ?? null;

  if (platformRole !== "admin" && platformRole !== "superadmin") {
    redirect("/dashboard");
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("client_health_report")
    .select("*")
    .order("client_name", { ascending: true });

  if (error) {
    throw new Error("No pudimos cargar el informe de estado de clientes.");
  }

  return <ReportsPanel rows={(data ?? []) as Views<"client_health_report">[]} />;
}
