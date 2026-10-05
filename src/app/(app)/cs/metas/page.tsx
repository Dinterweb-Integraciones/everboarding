import { CsMonthlyGoalsManager } from "@/components/cs/cs-monthly-goals-manager";
import { requireUser } from "@/lib/auth";
import { getCurrentMonthKey, type MonthlyGoalRow } from "@/lib/cs-monthly-goals";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CsMonthlyGoalsPage({
  searchParams,
}: {
  searchParams?: Promise<{ anio?: string }>;
}) {
  await requireUser("/cs/metas");
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const currentYear = Number(getCurrentMonthKey().slice(0, 4));
  const requestedYear = Number(resolvedSearchParams?.anio);
  const year =
    Number.isInteger(requestedYear) && requestedYear >= 2020 && requestedYear <= currentYear + 5
      ? requestedYear
      : currentYear;

  const admin = createSupabaseAdminClient();
  // Usuarios activos con rol CS, admin o superadmin que atienden al menos un cliente activo.
  const [{ data: profileRows, error: profilesError }, { data: clientRows, error: clientsError }] =
    await Promise.all([
      admin
        .from("profiles")
        .select("id, full_name, email")
        .in("platform_role", ["csm", "admin", "superadmin"])
        .eq("is_platform_active", true)
        .order("full_name", { ascending: true }),
      admin.from("clients").select("csm_user_id").eq("is_active", true).not("csm_user_id", "is", null),
    ]);

  if (profilesError || clientsError) {
    throw new Error("No pudimos cargar los Customer Success.");
  }

  // customer_success_monthly_goals no está en database.ts (ver límite de complejidad de tipos).
  const { data: goalRows, error: goalsError } = (await admin
    .from("customer_success_monthly_goals" as never)
    .select("customer_success_id, month, goal_credits")
    .gte("month", `${year}-01-01`)
    .lte("month", `${year}-12-01`)) as unknown as { data: MonthlyGoalRow[] | null; error: Error | null };

  if (goalsError) {
    throw new Error("No pudimos cargar las metas de Customer Success.");
  }

  const idsWithActiveClients = new Set(
    ((clientRows ?? []) as Array<{ csm_user_id: string | null }>).map((client) => client.csm_user_id),
  );
  const customerSuccess = ((profileRows ?? []) as Array<{ id: string; full_name: string | null; email: string }>)
    .filter((profile) => idsWithActiveClients.has(profile.id))
    .map((profile) => ({ id: profile.id, name: profile.full_name || profile.email }));

  return (
    <CsMonthlyGoalsManager
      year={year}
      currentMonth={getCurrentMonthKey()}
      customerSuccess={customerSuccess}
      initialGoals={goalRows ?? []}
    />
  );
}
