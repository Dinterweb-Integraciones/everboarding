import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { canAccessHubspotSales } from "@/lib/platform-access";

export default async function SalesIndexPage() {
  const { platformProfile } = await requireUser("/sales");
  const platformRole = platformProfile?.platform_role ?? null;

  redirect(canAccessHubspotSales(platformRole) ? "/sales/proposals/new" : "/sales/dinterweb");
}
