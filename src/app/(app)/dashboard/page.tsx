import { redirect } from "next/navigation";

import { ClientsDashboard } from "@/components/dashboard/clients-dashboard";
import { requireUser } from "@/lib/auth";
import { fetchUserMemberships } from "@/lib/membership-access";
import { getPlatformDefaultPath } from "@/lib/platform-access";
import { resolveStageFromProfileRole, type ClientSummary } from "@/lib/onboarding";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Tables } from "@/types/database";

export default async function DashboardPage() {
  const { supabase, user, platformProfile } = await requireUser();
  const platformRole = platformProfile?.platform_role ?? null;
  const canSeeAllClients = platformRole === "admin" || platformRole === "superadmin";

  if (platformRole === "sales" || platformRole === "finance") {
    redirect(getPlatformDefaultPath(platformRole));
  }

  const clientReader = canSeeAllClients ? createSupabaseAdminClient() : supabase;

  const [
    { data: clientRows, error: clientsError },
    { data: membershipRows, error: membershipError },
  ] =
    await Promise.all([
      clientReader.from("clients").select("*").order("updated_at", { ascending: false }),
      fetchUserMemberships(supabase, user.id),
    ]);

  if (clientsError) {
    throw new Error("No pudimos cargar los clientes.");
  }

  if (membershipError) {
    console.error("dashboard_memberships_load_failed", membershipError);
  }

  const membershipRecords = ((membershipError ? [] : membershipRows) ?? []) as Array<{
    client_id: string;
    access_role: "viewer" | "editor" | "owner";
    profile_role: "sales" | "csm" | "client" | "stakeholder";
  }>;
  const clientRecords = (clientRows ?? []) as Tables<"clients">[];

  const ownerClients = clientRecords.filter((client) => client.owner_user_id === user.id);
  const clientOnlyMode =
    ownerClients.length === 0 &&
    membershipRecords.length > 0 &&
    membershipRecords.every((membership) => membership.profile_role === "client");

  if (clientOnlyMode) {
    const membership = membershipRecords[0];
    redirect(
      `/clients/${membership.client_id}?stage=${resolveStageFromProfileRole(membership.profile_role)}`,
    );
  }

  const membershipMap = new Map(
    membershipRecords.map((membership) => [membership.client_id, membership.access_role]),
  );

  const visibleClientRecords =
    platformRole === "csm"
      ? clientRecords.filter(
          (client) =>
            client.csm_user_id === user.id ||
            membershipRecords.some(
              (membership) => membership.client_id === client.id && membership.profile_role === "csm",
            ),
        )
      : clientRecords;

  const clients: ClientSummary[] = visibleClientRecords.map((client) => ({
    ...client,
    access_role: client.owner_user_id === user.id ? "owner" : membershipMap.get(client.id) ?? "viewer",
  }));

  return <ClientsDashboard initialClients={clients} />;
}
