import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth/auth-form";
import { getOptionalUser } from "@/lib/auth";
import { getPlatformDefaultPath } from "@/lib/platform-access";

export default async function LoginPage() {
  const { user, platformProfile } = await getOptionalUser();

  if (user) {
    redirect(getPlatformDefaultPath(platformProfile?.platform_role ?? null));
  }

  return <AuthForm mode="login" />;
}
