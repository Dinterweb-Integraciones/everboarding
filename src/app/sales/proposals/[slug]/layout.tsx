import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { canAccessHubspotSales, getPlatformDefaultPath } from "@/lib/platform-access";

export default async function HubspotSalesProposalLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { platformProfile } = await requireUser("/sales/proposals");
  const platformRole = platformProfile?.platform_role ?? null;

  if (!canAccessHubspotSales(platformRole)) {
    redirect(getPlatformDefaultPath(platformRole));
  }

  return children;
}
