import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import {
  canManagePlatformUsers,
  normalizePlatformEmail,
  type PlatformRole,
} from "@/lib/platform-access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatUserError } from "@/lib/utils";

const platformRoles = new Set<PlatformRole>(["superadmin", "admin", "sales", "csm"]);

function isPlatformRole(value: string): value is PlatformRole {
  return platformRoles.has(value as PlatformRole);
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ profileId: string }> },
) {
  try {
    const { user, platformProfile } = await requireUser("/cs/usuarios");

    if (!canManagePlatformUsers(platformProfile?.platform_role ?? null)) {
      return NextResponse.json(
        { message: "Solo un superadmin puede administrar usuarios de plataforma." },
        { status: 403 },
      );
    }

    const { profileId } = await context.params;
    const body = (await request.json()) as {
      role?: string;
    };
    const role = body.role?.trim() || "";

    if (!profileId) {
      return NextResponse.json({ message: "El usuario no es valido." }, { status: 400 });
    }

    if (!isPlatformRole(role)) {
      return NextResponse.json({ message: "Selecciona un rol valido." }, { status: 400 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createSupabaseAdminClient() as any;
    const { data: currentProfile, error: profileError } = await admin
      .from("profiles")
      .select("*")
      .eq("id", profileId)
      .single();

    if (profileError) throw profileError;

    if (currentProfile.platform_role === "superadmin" && role !== "superadmin") {
      const { count: superadminCount, error: countError } = await admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("platform_role", "superadmin")
        .eq("is_platform_active", true);

      if (countError) throw countError;

      if ((superadminCount ?? 0) <= 1) {
        return NextResponse.json(
          { message: "Debe existir al menos un superadmin activo en la plataforma." },
          { status: 400 },
        );
      }
    }

    const { data: updatedProfile, error: updateError } = await admin
      .from("profiles")
      .update({
        platform_role: role,
        is_platform_active: true,
      })
      .eq("id", profileId)
      .select("*")
      .single();

    if (updateError) throw updateError;

    const { error: inviteUpdateError } = await admin
      .from("platform_user_invites")
      .update({
        role,
        invited_by_user_id: user.id,
        revoked_at: null,
      })
      .eq("email", normalizePlatformEmail(updatedProfile.email));

    if (inviteUpdateError) throw inviteUpdateError;

    return NextResponse.json({
      ...updatedProfile,
      message: "Rol actualizado correctamente.",
    });
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos actualizar el rol del usuario.") },
      { status: 400 },
    );
  }
}
