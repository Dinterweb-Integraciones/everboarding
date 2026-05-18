import type { User } from "@supabase/supabase-js";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";

export type PlatformRole = Database["public"]["Enums"]["platform_role"];
export type PlatformProfile = Database["public"]["Tables"]["profiles"]["Row"];
export type PlatformUserInvite = Database["public"]["Tables"]["platform_user_invites"]["Row"];

export const PLATFORM_ROLE_META: Record<
  PlatformRole,
  { label: string; description: string }
> = {
  superadmin: {
    label: "Superadmin",
    description: "Administra accesos, roles y la configuracion global de la plataforma.",
  },
  admin: {
    label: "Admin",
    description: "Gestiona la operacion interna y los catalogos administrativos.",
  },
  sales: {
    label: "Ventas",
    description: "Crea y administra propuestas comerciales desde ventas.",
  },
  csm: {
    label: "CS",
    description: "Gestiona clientes, onboarding y seguimiento operativo.",
  },
};

export function normalizePlatformEmail(email: string) {
  return email.trim().toLowerCase();
}

export function getPlatformRoleLabel(role: PlatformRole | null | undefined) {
  if (!role) return "Sin rol";
  return PLATFORM_ROLE_META[role].label;
}

export function canManagePlatformUsers(role: PlatformRole | null | undefined) {
  return role === "superadmin";
}

export function canAccessAdminCatalogs(role: PlatformRole | null | undefined) {
  return role === "admin" || role === "superadmin";
}

export function canAccessDashboard(role: PlatformRole | null | undefined) {
  return role === "csm" || role === "admin" || role === "superadmin";
}

export function canAccessDinterwebSales(role: PlatformRole | null | undefined) {
  return role === "sales" || role === "superadmin";
}

export function canAccessHubspotSales(role: PlatformRole | null | undefined) {
  return role === "superadmin";
}

export function getPlatformDefaultPath(role: PlatformRole | null | undefined) {
  if (role === "sales") {
    return "/sales/dinterweb";
  }

  return "/dashboard";
}

function getUserFullName(user: User) {
  const fullName =
    typeof user.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name
      : typeof user.user_metadata?.name === "string"
        ? user.user_metadata.name
        : null;

  return fullName?.trim() || user.email?.split("@")[0] || null;
}

type SyncPlatformAccessResult = {
  profile: PlatformProfile | null;
  hasAccess: boolean;
  wasBootstrapped: boolean;
};

export async function syncPlatformAccessForUser(
  user: User,
): Promise<SyncPlatformAccessResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createSupabaseAdminClient() as any;
  const normalizedEmail = normalizePlatformEmail(user.email ?? "");
  const fullName = getUserFullName(user);
  const now = new Date().toISOString();

  const { error: upsertError } = await admin.from("profiles").upsert({
    id: user.id,
    email: normalizedEmail,
    full_name: fullName,
  });

  if (upsertError) {
    throw upsertError;
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (profileError) {
    throw profileError;
  }

  if (profile.platform_role && profile.is_platform_active) {
    return {
      profile,
      hasAccess: true,
      wasBootstrapped: false,
    };
  }

  const { count: activeSuperadminCount, error: superadminCountError } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("platform_role", "superadmin")
    .eq("is_platform_active", true);

  if (superadminCountError) {
    throw superadminCountError;
  }

  if (!activeSuperadminCount) {
    const { data: bootstrappedProfile, error: bootstrapError } = await admin
      .from("profiles")
      .update({
        platform_role: "superadmin",
        is_platform_active: true,
        platform_invited_at: profile.platform_invited_at ?? now,
        platform_activated_at: profile.platform_activated_at ?? now,
      })
      .eq("id", user.id)
      .select("*")
      .single();

    if (bootstrapError) {
      throw bootstrapError;
    }

    return {
      profile: bootstrappedProfile,
      hasAccess: true,
      wasBootstrapped: true,
    };
  }

  const { data: invite, error: inviteError } = await admin
    .from("platform_user_invites")
    .select("*")
    .eq("email", normalizedEmail)
    .is("revoked_at", null)
    .maybeSingle();

  if (inviteError) {
    throw inviteError;
  }

  if (!invite) {
    return {
      profile,
      hasAccess: false,
      wasBootstrapped: false,
    };
  }

  const { data: activatedProfile, error: activationError } = await admin
    .from("profiles")
    .update({
      platform_role: invite.role,
      is_platform_active: true,
      platform_invited_by_user_id: invite.invited_by_user_id,
      platform_invited_at: profile.platform_invited_at ?? invite.created_at ?? now,
      platform_activated_at: profile.platform_activated_at ?? now,
    })
    .eq("id", user.id)
    .select("*")
    .single();

  if (activationError) {
    throw activationError;
  }

  const { error: inviteUpdateError } = await admin
    .from("platform_user_invites")
    .update({
      invited_user_id: user.id,
      accepted_at: invite.accepted_at ?? now,
    })
    .eq("id", invite.id);

  if (inviteUpdateError) {
    throw inviteUpdateError;
  }

  return {
    profile: activatedProfile,
    hasAccess: true,
    wasBootstrapped: false,
  };
}
