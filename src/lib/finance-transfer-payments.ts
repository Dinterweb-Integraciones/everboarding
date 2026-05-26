import {
  addDaysToIsoDate,
  addMonthsClampedToIsoDate,
  getClientCycleWindow,
} from "@/lib/transfer-billing";
import { mapSalesProposalRow, type SalesProposalRecord } from "@/lib/sales-proposals";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { toIsoDate } from "@/lib/utils";
import type { Database } from "@/types/database";

type SalesProposalRow = Database["public"]["Tables"]["sales_proposals"]["Row"];
type ClientBillingCycleRow = Database["public"]["Tables"]["client_billing_cycles"]["Row"];

export type FinanceTransferPaymentItem =
  | {
      id: string;
      kind: "initial";
      proposalId: string;
      slug: string;
      workspaceVariant: SalesProposalRecord["workspaceVariant"];
      title: string;
      sellerName: string;
      sellerEmail: string;
      clientName: string;
      clientCompany: string;
      clientEmail: string;
      amount: number;
      currency: string;
      contractedCredits: number;
      periodMonths: SalesProposalRecord["periodMonths"];
      dueDate: string;
      cycleStartDate: string;
      cycleEndDate: string;
      transferBank: string;
      transferReference: string;
      assignedCsmUserId: string;
      updatedAt: string;
    }
  | {
      id: string;
      kind: "renewal";
      proposalId: string;
      slug: string;
      workspaceVariant: SalesProposalRecord["workspaceVariant"];
      title: string;
      sellerName: string;
      sellerEmail: string;
      clientName: string;
      clientCompany: string;
      clientEmail: string;
      amount: number;
      currency: string;
      contractedCredits: number;
      periodMonths: SalesProposalRecord["periodMonths"];
      dueDate: string;
      cycleStartDate: string;
      cycleEndDate: string;
      transferBank: string;
      transferReference: string;
      assignedCsmUserId: string;
      updatedAt: string;
      activatedClientId: string;
    };

function toInitialFinanceItem(proposal: SalesProposalRecord): FinanceTransferPaymentItem {
  return {
    id: `proposal:${proposal.id}`,
    kind: "initial",
    proposalId: proposal.id ?? "",
    slug: proposal.slug ?? "",
    workspaceVariant: proposal.workspaceVariant,
    title: proposal.title,
    sellerName: proposal.sellerName,
    sellerEmail: proposal.sellerEmail,
    clientName: proposal.clientName,
    clientCompany: proposal.clientCompany,
    clientEmail: proposal.clientEmail,
    amount: proposal.quotedPrice,
    currency: proposal.currency,
    contractedCredits: proposal.contractedCredits,
    periodMonths: proposal.periodMonths,
    dueDate: proposal.startDate,
    cycleStartDate: proposal.startDate,
    cycleEndDate: proposal.startDate,
    transferBank: proposal.transferBank,
    transferReference: proposal.transferReference,
    assignedCsmUserId: proposal.assignedCsmUserId,
    updatedAt: proposal.updatedAt,
  };
}

async function buildRenewalFinanceItem(
  proposal: SalesProposalRecord,
  latestPaidCycle: ClientBillingCycleRow | null,
  todayIsoDate: string,
) {
  const activatedClientId = proposal.activatedClientId;
  if (!activatedClientId) {
    return null;
  }

  const nextCycleStartDate =
    latestPaidCycle?.cycle_end_date
      ? addDaysToIsoDate(latestPaidCycle.cycle_end_date, 1)
      : proposal.paidAt?.slice(0, 10) || proposal.activatedAt?.slice(0, 10) || proposal.startDate;

  if (nextCycleStartDate > todayIsoDate) {
    return null;
  }

  let cycleEndDate = nextCycleStartDate;
  for (let monthIndex = 0; monthIndex < proposal.periodMonths; monthIndex += 1) {
    const cycleReferenceDate = addMonthsClampedToIsoDate(nextCycleStartDate, monthIndex);
    const cycleWindow = await getClientCycleWindow(activatedClientId, cycleReferenceDate);
    cycleEndDate = cycleWindow.cycle_end_date;
  }

  return {
    id: `renewal:${proposal.id}:${nextCycleStartDate}`,
    kind: "renewal",
    proposalId: proposal.id ?? "",
    slug: proposal.slug ?? "",
    workspaceVariant: proposal.workspaceVariant,
    title: proposal.title,
    sellerName: proposal.sellerName,
    sellerEmail: proposal.sellerEmail,
    clientName: proposal.clientName,
    clientCompany: proposal.clientCompany,
    clientEmail: proposal.clientEmail,
    amount: proposal.quotedPrice,
    currency: proposal.currency,
    contractedCredits: proposal.contractedCredits,
    periodMonths: proposal.periodMonths,
    dueDate: nextCycleStartDate,
    cycleStartDate: nextCycleStartDate,
    cycleEndDate,
    transferBank: latestPaidCycle?.transfer_bank || proposal.transferBank || "",
    transferReference: "",
    assignedCsmUserId: proposal.assignedCsmUserId,
    updatedAt: latestPaidCycle?.updated_at || proposal.updatedAt,
    activatedClientId,
  } satisfies FinanceTransferPaymentItem;
}

export async function listFinanceTransferPaymentItems() {
  const admin = createSupabaseAdminClient();
  const [{ data: initialRows, error: initialError }, { data: renewalRows, error: renewalError }] =
    await Promise.all([
      admin
        .from("sales_proposals")
        .select("*")
        .eq("payment_method", "bank_transfer")
        .eq("status", "transfer_pending")
        .order("updated_at", { ascending: false }),
      admin
        .from("sales_proposals")
        .select("*")
        .eq("payment_method", "bank_transfer")
        .eq("billing_mode", "subscription")
        .eq("status", "board_activated")
        .not("activated_client_id", "is", null)
        .order("updated_at", { ascending: false }),
    ]);

  if (initialError || renewalError) {
    throw initialError ?? renewalError ?? new Error("No pudimos cargar los pagos por transferencia.");
  }

  const initialProposals = ((initialRows ?? []) as SalesProposalRow[]).map((proposal) =>
    mapSalesProposalRow(proposal),
  );
  const renewalProposals = ((renewalRows ?? []) as SalesProposalRow[]).map((proposal) =>
    mapSalesProposalRow(proposal),
  );

  const renewalClientIds = renewalProposals
    .map((proposal) => proposal.activatedClientId)
    .filter((clientId): clientId is string => Boolean(clientId));
  const latestCyclesByClientId = new Map<string, ClientBillingCycleRow>();

  if (renewalClientIds.length) {
    const { data: cycleRows, error: cyclesError } = await admin
      .from("client_billing_cycles")
      .select("*")
      .in("client_id", renewalClientIds)
      .eq("status", "paid")
      .eq("payment_method", "bank_transfer")
      .order("client_id", { ascending: true })
      .order("cycle_start_date", { ascending: false });
    const typedCycleRows = (cycleRows ?? []) as ClientBillingCycleRow[];

    if (cyclesError) {
      throw cyclesError;
    }

    typedCycleRows.forEach((cycle) => {
      if (!latestCyclesByClientId.has(cycle.client_id)) {
        latestCyclesByClientId.set(cycle.client_id, cycle);
      }
    });
  }

  const todayIsoDate = toIsoDate();
  const renewalItems = (
    await Promise.all(
      renewalProposals.map((proposal) =>
        buildRenewalFinanceItem(
          proposal,
          proposal.activatedClientId ? latestCyclesByClientId.get(proposal.activatedClientId) ?? null : null,
          todayIsoDate,
        ),
      ),
    )
  ).filter((item): item is Extract<FinanceTransferPaymentItem, { kind: "renewal" }> => Boolean(item));

  return [...initialProposals.map(toInitialFinanceItem), ...renewalItems].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
      || right.dueDate.localeCompare(left.dueDate),
  );
}
