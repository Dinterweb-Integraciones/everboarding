import { redirect } from "next/navigation";

import { isAllowedDinterwebUser } from "@/lib/auth-domain";
import { syncPlatformAccessForUser } from "@/lib/platform-access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function buildLoginHref(nextPath?: string) {
  if (!nextPath || !nextPath.startsWith("/")) {
    return "/login";
  }

  return `/login?next=${encodeURIComponent(nextPath)}`;
}

export async function requireUser(nextPath?: string) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(buildLoginHref(nextPath));
  }

  if (!isAllowedDinterwebUser(user)) {
    await supabase.auth.signOut();
    const loginHref = buildLoginHref(nextPath);
    redirect(loginHref.includes("?") ? `${loginHref}&error=domain` : `${loginHref}?error=domain`);
  }

  const platformAccess = await syncPlatformAccessForUser(user);

  if (!platformAccess.hasAccess) {
    await supabase.auth.signOut();
    const loginHref = buildLoginHref(nextPath);
    redirect(loginHref.includes("?") ? `${loginHref}&error=invite` : `${loginHref}?error=invite`);
  }

  return { supabase, user, platformProfile: platformAccess.profile };
}

export async function getOptionalUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user && !isAllowedDinterwebUser(user)) {
    await supabase.auth.signOut();
    return { supabase, user: null, platformProfile: null };
  }

  if (!user) {
    return { supabase, user: null, platformProfile: null };
  }

  const platformAccess = await syncPlatformAccessForUser(user);
  if (!platformAccess.hasAccess) {
    await supabase.auth.signOut();
    return { supabase, user: null, platformProfile: null };
  }

  return { supabase, user, platformProfile: platformAccess.profile };
}
