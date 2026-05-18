import { redirect } from "next/navigation";

import { PlatformUsersManager } from "@/components/cs/platform-users-manager";
import { requireUser } from "@/lib/auth";
import { canManagePlatformUsers } from "@/lib/platform-access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PlatformUsersPage() {
  const { user, platformProfile } = await requireUser("/cs/usuarios");

  if (!canManagePlatformUsers(platformProfile?.platform_role ?? null)) {
    redirect("/dashboard");
  }

  const admin = createSupabaseAdminClient();
  const [
    { data: profileRows, error: profilesError },
    { data: inviteRows, error: invitesError },
  ] = await Promise.all([
    admin
      .from("profiles")
      .select("*")
      .not("platform_role", "is", null)
      .order("is_platform_active", { ascending: false })
      .order("platform_role")
      .order("full_name")
      .order("email"),
    admin
      .from("platform_user_invites")
      .select("*")
      .is("accepted_at", null)
      .is("revoked_at", null)
      .order("created_at", { ascending: false }),
  ]);

  if (profilesError) {
    throw new Error("No pudimos cargar los usuarios de la plataforma.");
  }

  if (invitesError) {
    throw new Error("No pudimos cargar las invitaciones pendientes.");
  }

  return (
    <PlatformUsersManager
      initialUsers={(profileRows ?? []) as Database["public"]["Tables"]["profiles"]["Row"][]}
      initialPendingInvites={
        (inviteRows ?? []) as Database["public"]["Tables"]["platform_user_invites"]["Row"][]
      }
      currentUserId={user.id}
    />
  );
}
