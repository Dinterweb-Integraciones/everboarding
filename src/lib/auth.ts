import { redirect } from "next/navigation";

import { isAllowedDinterwebUser } from "@/lib/auth-domain";
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

  return { supabase, user };
}

export async function getOptionalUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user && !isAllowedDinterwebUser(user)) {
    await supabase.auth.signOut();
    return { supabase, user: null };
  }

  return { supabase, user };
}
