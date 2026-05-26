import { redirect } from "next/navigation";

import { FinanceTransferPaymentsManager } from "@/components/finance/finance-transfer-payments-manager";
import { requireUser } from "@/lib/auth";
import { listFinanceTransferPaymentItems } from "@/lib/finance-transfer-payments";
import { canAccessFinance } from "@/lib/platform-access";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function FinanceTransfersPage() {
  const { platformProfile } = await requireUser("/finanzas");
  const platformRole = platformProfile?.platform_role ?? null;

  if (!canAccessFinance(platformRole)) {
    redirect("/dashboard");
  }

  return (
    <FinanceTransferPaymentsManager
      initialItems={await listFinanceTransferPaymentItems()}
    />
  );
}
