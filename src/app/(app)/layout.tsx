import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth";
import { fetchUserMemberships } from "@/lib/membership-access";
import { resolveStageFromProfileRole } from "@/lib/onboarding";

export default async function ProtectedLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { supabase, user } = await requireUser();

  const [{ data: ownedClients }, membershipLookup] = await Promise.all([
    supabase.from("clients").select("id").eq("owner_user_id", user.id),
    fetchUserMemberships(supabase, user.id),
  ]);

  const hasOwnedClients = (ownedClients ?? []).length > 0;
  if (membershipLookup.error) {
    console.error("layout_memberships_load_failed", membershipLookup.error);
  }

  const membershipRecords = ((membershipLookup.error ? [] : membershipLookup.data) ?? []) as Array<{
    client_id: string;
    profile_role: "sales" | "csm" | "client" | "stakeholder";
  }>;
  const clientOnlyMode =
    !hasOwnedClients &&
    membershipRecords.length > 0 &&
    membershipRecords.every((membership) => membership.profile_role === "client");

  const firstMembership = membershipRecords[0];
  const homeHref =
    clientOnlyMode && firstMembership
      ? `/clients/${firstMembership.client_id}?stage=${resolveStageFromProfileRole(firstMembership.profile_role)}`
      : "/dashboard";

  return (
    <AppShell
      email={user.email ?? "usuario@local"}
      homeHref={homeHref}
      showDashboardLink={!clientOnlyMode}
    >
      {children}
    </AppShell>
  );
}
