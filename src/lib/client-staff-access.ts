import { canAccessAdminCatalogs, type PlatformRole } from "@/lib/platform-access";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

export function isClientStaffRole(role: PlatformRole | null | undefined) {
  return role === "csm" || canAccessAdminCatalogs(role);
}

// Admin y superadmin gestionan cualquier cliente; un Customer Success solo los
// que atiende (asignado como CSM o miembro con rol csm).
export async function canManageClientAsStaff(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  role: PlatformRole | null | undefined,
  userId: string,
  clientId: string,
) {
  if (canAccessAdminCatalogs(role)) return true;
  if (role !== "csm") return false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reader = admin as any;
  const [{ data: clientRow, error: clientError }, { data: membershipRow, error: membershipError }] =
    await Promise.all([
      reader.from("clients").select("csm_user_id").eq("id", clientId).maybeSingle(),
      reader
        .from("client_members")
        .select("profile_role")
        .eq("client_id", clientId)
        .eq("user_id", userId)
        .eq("profile_role", "csm")
        .maybeSingle(),
    ]);

  if (clientError) throw clientError;
  if (membershipError) throw membershipError;

  return Boolean(clientRow) && (clientRow.csm_user_id === userId || Boolean(membershipRow));
}
