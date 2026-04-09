import type { SupabaseClient } from "@supabase/supabase-js";

import type { ClientProfileRole } from "@/lib/onboarding";
import type { Database } from "@/types/database";

type MembershipRecord = {
  client_id: string;
  access_role: "viewer" | "editor" | "owner";
  profile_role: ClientProfileRole;
};

type ClientMembershipRecord = {
  access_role?: "viewer" | "editor" | "owner";
  profile_role?: ClientProfileRole;
} | null;

type QueryError = { message?: string } | null;

function isMissingProfileRoleColumn(error: QueryError) {
  const message = error?.message?.toLowerCase() ?? "";
  return message.includes("profile_role") && message.includes("does not exist");
}

export async function fetchUserMemberships(
  supabase: SupabaseClient<Database>,
  userId: string,
) {
  const primary = await supabase
    .from("client_members")
    .select("client_id, access_role, profile_role")
    .eq("user_id", userId);

  if (!primary.error) {
    return {
      data: (primary.data ?? []) as MembershipRecord[],
      error: null as QueryError,
    };
  }

  if (!isMissingProfileRoleColumn(primary.error)) {
    return {
      data: [] as MembershipRecord[],
      error: primary.error,
    };
  }

  const fallback = await supabase
    .from("client_members")
    .select("client_id, access_role")
    .eq("user_id", userId);

  return {
    data: ((fallback.data ?? []) as Array<{
      client_id: string;
      access_role: "viewer" | "editor" | "owner";
    }>).map((membership) => ({
      ...membership,
      profile_role: "stakeholder" as ClientProfileRole,
    })),
    error: fallback.error,
  };
}

export async function fetchClientMembership(
  supabase: SupabaseClient<Database>,
  clientId: string,
  userId: string,
) {
  const primary = await supabase
    .from("client_members")
    .select("access_role, profile_role")
    .eq("client_id", clientId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!primary.error) {
    return {
      data: (primary.data as ClientMembershipRecord) ?? null,
      error: null as QueryError,
    };
  }

  if (!isMissingProfileRoleColumn(primary.error)) {
    return {
      data: null as ClientMembershipRecord,
      error: primary.error,
    };
  }

  const fallback = await supabase
    .from("client_members")
    .select("access_role")
    .eq("client_id", clientId)
    .eq("user_id", userId)
    .maybeSingle();

  return {
    data: fallback.data
      ? {
          ...(fallback.data as { access_role?: "viewer" | "editor" | "owner" }),
          profile_role: "stakeholder" as ClientProfileRole,
        }
      : null,
    error: fallback.error,
  };
}
