import { redirect } from "next/navigation";

import { getOptionalUser } from "@/lib/auth";
import { getPlatformDefaultPath } from "@/lib/platform-access";

export default async function HomePage() {
  const { user, platformProfile } = await getOptionalUser();

  redirect(user ? getPlatformDefaultPath(platformProfile?.platform_role ?? null) : "/login");
}
