import { NextResponse } from "next/server";

import { isAllowedEmailDomain } from "@/lib/auth-domain";
import { requireUser } from "@/lib/auth";
import {
  canManagePlatformUsers,
  normalizePlatformEmail,
  type PlatformRole,
} from "@/lib/platform-access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatUserError } from "@/lib/utils";

const platformRoles = new Set<PlatformRole>(["superadmin", "admin", "finance", "sales", "csm"]);

function isPlatformRole(value: string): value is PlatformRole {
  return platformRoles.has(value as PlatformRole);
}

export async function POST(request: Request) {
  try {
    const { user, platformProfile } = await requireUser("/cs/usuarios");

    if (!canManagePlatformUsers(platformProfile?.platform_role ?? null)) {
      return NextResponse.json(
        { message: "Solo un superadmin puede administrar usuarios de plataforma." },
        { status: 403 },
      );
    }

    const body = (await request.json()) as {
      email?: string;
      fullName?: string | null;
      role?: string;
    };

    const email = normalizePlatformEmail(body.email ?? "");
    const fullName = body.fullName?.trim() || null;
    const role = body.role?.trim() || "";

    if (!email) {
      return NextResponse.json({ message: "El correo corporativo es requerido." }, { status: 400 });
    }

    if (!isAllowedEmailDomain(email)) {
      return NextResponse.json(
        { message: "Solo puedes invitar correos corporativos de Dinterweb." },
        { status: 400 },
      );
    }

    if (!isPlatformRole(role)) {
      return NextResponse.json({ message: "Selecciona un rol valido." }, { status: 400 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createSupabaseAdminClient() as any;
    const now = new Date().toISOString();
    const { data: existingProfile, error: profileLookupError } = await admin
      .from("profiles")
      .select("*")
      .eq("email", email)
      .maybeSingle();

    if (profileLookupError) throw profileLookupError;

    if (existingProfile) {
      const { data: updatedProfile, error: updateProfileError } = await admin
        .from("profiles")
        .update({
          full_name: fullName || existingProfile.full_name,
          platform_role: role,
          is_platform_active: true,
          platform_invited_by_user_id: user.id,
          platform_invited_at: existingProfile.platform_invited_at ?? now,
          platform_activated_at: existingProfile.platform_activated_at ?? now,
        })
        .eq("id", existingProfile.id)
        .select("*")
        .single();

      if (updateProfileError) throw updateProfileError;

      const { error: inviteUpsertError } = await admin.from("platform_user_invites").upsert(
        {
          email,
          full_name: fullName || updatedProfile.full_name,
          role,
          invited_by_user_id: user.id,
          invited_user_id: updatedProfile.id,
          accepted_at: now,
          revoked_at: null,
        },
        { onConflict: "email" },
      );

      if (inviteUpsertError) throw inviteUpsertError;

      return NextResponse.json({
        user: updatedProfile,
        invite: null,
        message: "Usuario habilitado y rol asignado correctamente.",
      });
    }

    const { data: invite, error: inviteError } = await admin
      .from("platform_user_invites")
      .upsert(
        {
          email,
          full_name: fullName,
          role,
          invited_by_user_id: user.id,
          invited_user_id: null,
          accepted_at: null,
          revoked_at: null,
        },
        { onConflict: "email" },
      )
      .select("*")
      .single();

    if (inviteError) throw inviteError;

    return NextResponse.json({
      user: null,
      invite,
      message: "Invitacion registrada. El acceso se activara cuando el usuario inicie sesion.",
    });
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos registrar el acceso del usuario.") },
      { status: 400 },
    );
  }
}
