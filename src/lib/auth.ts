import { redirect } from "next/navigation";

import { isAllowedDinterwebUser } from "@/lib/auth-domain";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  if (!isAllowedDinterwebUser(user)) {
    await supabase.auth.signOut();
    redirect("/login?error=domain");
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
