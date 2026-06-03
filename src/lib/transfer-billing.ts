import { safeParseNumber, toIsoDate } from "@/lib/utils";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";

type ClientBillingCycleRow = Database["public"]["Tables"]["client_billing_cycles"]["Row"];
type OnboardingConfigRow = Database["public"]["Tables"]["onboarding_configs"]["Row"];

type ClientCycleWindow = {
  cycle_start_date: string;
  cycle_end_date: string;
};

type RecordManualTransferBillingCyclesInput = {
  clientId: string;
  proposalId: string | null;
  cycleStartDate: string;
  transferBank: string;
  transferReference: string;
  validatedAt: string;
  validatedByUserId: string;
  amountCents: number;
  currency: string;
};

function parseIsoDateOnly(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatIsoDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function addDaysToIsoDate(value: string, days: number) {
  const date = parseIsoDateOnly(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatIsoDateOnly(date);
}

export function addMonthsClampedToIsoDate(value: string, months: number) {
  const date = parseIsoDateOnly(value);
  const targetYear = date.getUTCFullYear();
  const targetMonthIndex = date.getUTCMonth() + months;
  const target = new Date(Date.UTC(targetYear, targetMonthIndex, 1));
  const originalDay = date.getUTCDate();
  const lastDayOfMonth = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();

  target.setUTCDate(Math.min(originalDay, lastDayOfMonth));
  return formatIsoDateOnly(target);
}

function distributeCredits(totalCredits: number, periodMonths: 1 | 3 | 6 | 12) {
  const monthlyBase = Math.floor(totalCredits / periodMonths);
  const monthlyRemainder = totalCredits % periodMonths;

  return Array.from({ length: periodMonths }, (_, index) =>
    monthlyBase + (index < monthlyRemainder ? 1 : 0),
  );
}

export async function getClientCycleWindow(clientId: string, referenceDate: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("get_client_cycle_window" as never, {
    p_client_id: clientId,
    p_reference_date: referenceDate,
  } as never);
  const rows = (data ?? []) as ClientCycleWindow[];

  if (error) {
    throw error;
  }

  const cycleWindow = rows[0] ?? null;
  if (!cycleWindow) {
    throw new Error("No pudimos calcular la ventana del ciclo del cliente.");
  }

  return cycleWindow;
}

async function loadBillingConfig(clientId: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("onboarding_configs")
    .select("*")
    .eq("client_id", clientId)
    .maybeSingle();
  const config = data as OnboardingConfigRow | null;

  if (error || !config) {
    throw error ?? new Error("No encontramos la configuracion de billing del cliente.");
  }

  return config;
}

async function upsertBillingCycle(input: {
  clientId: string;
  proposalId: string | null;
  cycleStartDate: string;
  cycleEndDate: string;
  paidAt: string;
  transferBank: string;
  transferReference: string;
  validatedByUserId: string;
  amountCents: number | null;
  currency: string;
}) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("client_billing_cycles")
    .upsert(({
      client_id: input.clientId,
      sales_proposal_id: input.proposalId,
      cycle_start_date: input.cycleStartDate,
      cycle_end_date: input.cycleEndDate,
      status: "paid",
      paid_at: input.paidAt,
      amount_cents: input.amountCents,
      currency: input.currency.toLowerCase(),
      payment_method: "bank_transfer",
      transfer_bank: input.transferBank,
      transfer_reference: input.transferReference,
      transfer_validated_at: input.paidAt,
      transfer_validated_by_user_id: input.validatedByUserId,
      stripe_checkout_session_id: null,
      stripe_payment_intent_id: null,
      stripe_subscription_id: null,
      stripe_invoice_id: null,
      updated_at: input.paidAt,
    }) as never, {
      onConflict: "client_id,cycle_start_date",
    })
    .select("*")
    .single();
  const cycle = data as ClientBillingCycleRow | null;

  if (error || !cycle) {
    throw error ?? new Error("No pudimos registrar el ciclo de billing por transferencia.");
  }

  return cycle;
}

async function upsertCreditGrant(input: {
  clientId: string;
  billingCycleId: string;
  grantedCredits: number;
  grantDate: string;
  expiresAt: string;
}) {
  const admin = createSupabaseAdminClient();
  const { data: existingGrant, error: existingGrantError } = await admin
    .from("client_credit_grants")
    .select("id")
    .eq("billing_cycle_id", input.billingCycleId)
    .maybeSingle();
  const typedExistingGrant = existingGrant as { id: string } | null;

  if (existingGrantError) {
    throw existingGrantError;
  }

  const grantPayload = {
    client_id: input.clientId,
    billing_cycle_id: input.billingCycleId,
    source: "monthly_cycle",
    granted_credits: input.grantedCredits,
    grant_date: input.grantDate,
    expires_at: input.expiresAt,
  };

  const grantMutation = typedExistingGrant
    ? admin
        .from("client_credit_grants")
        .update(grantPayload as never)
        .eq("id", typedExistingGrant.id)
    : admin
        .from("client_credit_grants")
        .insert(grantPayload as never);

  const { error } = await grantMutation;

  if (error) {
    throw error;
  }
}

export async function recordManualTransferBillingCycles(
  input: RecordManualTransferBillingCyclesInput,
) {
  const normalizedCycleStartDate = input.cycleStartDate || toIsoDate();
  const normalizedValidatedAt = input.validatedAt || new Date().toISOString();
  const normalizedBank = input.transferBank.trim();
  const normalizedReference = input.transferReference.trim();

  if (!normalizedBank) {
    throw new Error("Selecciona o ingresa el banco antes de confirmar la transferencia.");
  }

  if (!normalizedReference) {
    throw new Error("Ingresa una referencia de transferencia valida.");
  }

  const config = await loadBillingConfig(input.clientId);
  const periodMonths =
    config.custom_plan_period_months === 3 ||
    config.custom_plan_period_months === 6 ||
    config.custom_plan_period_months === 12
      ? config.custom_plan_period_months
      : 1;
  const contractCredits = Math.max(
    0,
    safeParseNumber(config.custom_plan_credits ?? config.base_capacity * periodMonths),
  );
  const creditValidityDays = Math.max(1, safeParseNumber(config.credit_validity_days));
  const monthlyCredits = distributeCredits(contractCredits, periodMonths);

  for (let monthIndex = 0; monthIndex < periodMonths; monthIndex += 1) {
    const cycleReferenceDate = addMonthsClampedToIsoDate(normalizedCycleStartDate, monthIndex);
    const cycleWindow = await getClientCycleWindow(input.clientId, cycleReferenceDate);
    const paidCycle = await upsertBillingCycle({
      clientId: input.clientId,
      proposalId: input.proposalId,
      cycleStartDate: cycleWindow.cycle_start_date,
      cycleEndDate: cycleWindow.cycle_end_date,
      paidAt: normalizedValidatedAt,
      transferBank: normalizedBank,
      transferReference: normalizedReference,
      validatedByUserId: input.validatedByUserId,
      amountCents: monthIndex === 0 ? Math.max(0, Math.round(input.amountCents)) : null,
      currency: input.currency,
    });

    await upsertCreditGrant({
      clientId: input.clientId,
      billingCycleId: paidCycle.id,
      grantedCredits: monthlyCredits[monthIndex] ?? 0,
      grantDate: cycleWindow.cycle_start_date,
      expiresAt: addDaysToIsoDate(cycleWindow.cycle_start_date, creditValidityDays),
    });
  }

  const admin = createSupabaseAdminClient();
  const { error: expireError } = await admin.rpc("expire_unused_client_credits" as never, {
    p_client_id: input.clientId,
  } as never);

  if (expireError) {
    throw expireError;
  }
}
