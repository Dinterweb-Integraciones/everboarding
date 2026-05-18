import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { canAccessAdminCatalogs } from "@/lib/platform-access";

export default async function CsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { platformProfile } = await requireUser("/cs");
  const platformRole = platformProfile?.platform_role ?? null;

  if (!canAccessAdminCatalogs(platformRole)) {
    redirect("/dashboard");
  }

  return children;
}
