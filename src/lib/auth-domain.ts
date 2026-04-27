import type { User } from "@supabase/supabase-js";

export const DINTERWEB_EMAIL_DOMAIN = "dinterweb.com";

export function isAllowedEmailDomain(email: string | null | undefined) {
  if (!email) {
    return false;
  }

  return email.toLowerCase().endsWith(`@${DINTERWEB_EMAIL_DOMAIN}`);
}

export function isAllowedDinterwebUser(user: User | null | undefined) {
  if (!user) {
    return false;
  }

  return isAllowedEmailDomain(user.email);
}
