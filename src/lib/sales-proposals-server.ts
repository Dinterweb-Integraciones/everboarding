import Stripe from "stripe";

import {
  PUBLIC_EXTRA_CREDIT_PACKAGE,
  SALES_PROPOSAL_BASE_CREDITS,
  SALES_PROPOSAL_BASE_PRICE,
} from "@/lib/constants";
import {
  applyPercentageDiscount,
  getSalesProposalActivationValidation,
  isValidSalesProposalClientEmail,
  mapSalesProposalRow,
  normalizeSalesPaymentMethod,
  normalizeCouponPercentageOff,
  normalizeSalesCouponType,
  setSalesProposalExtraPackages,
  serializeSalesProposalDraft,
  serializeSalesProposalFullSnapshot,
  type SalesCouponType,
  type SalesProposalDraft,
  type SalesProposalPaymentMethod,
  type SalesProposalRecord,
} from "@/lib/sales-proposals";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordManualTransferBillingCycles } from "@/lib/transfer-billing";
import { isMissingSupabaseTable, safeParseNumber, slugify, toIsoDate } from "@/lib/utils";
import type { Database } from "@/types/database";

type RecordStripeCheckoutPaymentArgs =
  Database["public"]["Functions"]["record_stripe_checkout_payment"]["Args"];
type SalesProposalRow = Database["public"]["Tables"]["sales_proposals"]["Row"];
type SalesProposalSnapshotRow = Database["public"]["Tables"]["sales_proposal_snapshots"]["Row"];
type SalesCouponRow = Database["public"]["Tables"]["sales_coupons"]["Row"];
type ClientRow = Database["public"]["Tables"]["clients"]["Row"];
type OnboardingInitiativeRow = Database["public"]["Tables"]["onboarding_initiatives"]["Row"];

type SalesProposalActivationResult =
  | {
      url: string;
      proposal?: never;
      message?: never;
    }
  | {
      url?: never;
      proposal: SalesProposalRecord;
      message: string;
    };

type SalesProposalPaymentContext = {
  paymentMethod?: SalesProposalPaymentMethod;
  checkoutSessionId: string | null;
  paymentIntentId: string | null;
  subscriptionId: string | null;
  invoiceId: string | null;
  amountCents: number;
  currency: string;
  transferBank?: string | null;
  transferReference?: string | null;
  transferValidatedAt?: string | null;
  transferValidatedByUserId?: string | null;
  recordStripePayment?: boolean;
};

const LEGACY_SALES_COUPON_GRANTED_CREDITS = 40;
const LEGACY_SALES_COUPON_PRICE = 0;
const MANAGUA_UTC_OFFSET = "-06:00";

async function loadSalesProposalSnapshot(proposalId: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("sales_proposal_snapshots")
    .select("snapshot")
    .eq("proposal_id", proposalId)
    .maybeSingle();
  const snapshotRow = data as Pick<SalesProposalSnapshotRow, "snapshot"> | null;

  if (error) {
    if (isMissingSupabaseTable(error, "sales_proposal_snapshots")) {
      return null;
    }

    throw error;
  }

  return snapshotRow?.snapshot ?? null;
}

function attachSalesProposalSnapshot(row: SalesProposalRow, snapshot: unknown) {
  if (!snapshot) {
    return row;
  }

  return {
    ...row,
    snapshot,
  };
}

async function mapSalesProposalRecord(row: SalesProposalRow) {
  const snapshot = await loadSalesProposalSnapshot(row.id);
  return mapSalesProposalRow(attachSalesProposalSnapshot(row, snapshot));
}

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("La pasarela de pago no esta configurada.");
  }

  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

function resolveOrigin(request: Request) {
  const requestOrigin = request.headers.get("origin") || new URL(request.url).origin;

  if (requestOrigin.includes("localhost") || requestOrigin.includes("127.0.0.1")) {
    return requestOrigin.replace(/\/$/, "");
  }

  return (process.env.NEXT_PUBLIC_SITE_URL || requestOrigin).replace(/\/$/, "");
}

function resolveCurrency(value: string | null | undefined) {
  return (value || process.env.STRIPE_CURRENCY || "usd").toLowerCase();
}

function getErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
}

function isSalesProposalSlugConflict(error: unknown) {
  if (getErrorCode(error) !== "23505") {
    return false;
  }

  const message =
    typeof error === "object" && error !== null && "message" in error ? String(error.message) : "";

  return message.toLowerCase().includes("sales_proposals_slug_key") || message.toLowerCase().includes("slug");
}

function normalizeSalesCouponCode(value: string) {
  return value.trim().toUpperCase();
}

function normalizeSalesCouponBoundary(
  value: string | null | undefined,
  boundary: "start" | "end",
) {
  if (!value?.trim()) {
    return null;
  }

  const normalized = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return boundary === "start"
      ? `${normalized}T00:00:00.000${MANAGUA_UTC_OFFSET}`
      : `${normalized}T23:59:59.999${MANAGUA_UTC_OFFSET}`;
  }

  const parsedDate = new Date(normalized);
  if (Number.isNaN(parsedDate.getTime())) {
    throw new Error("Ingresa una fecha de vigencia valida.");
  }

  return parsedDate.toISOString();
}

export function normalizeSalesCouponSchedule(input: {
  startsAt?: string | null;
  endsAt?: string | null;
}) {
  const startsAt = normalizeSalesCouponBoundary(input.startsAt, "start");
  const endsAt = normalizeSalesCouponBoundary(input.endsAt, "end");

  if (startsAt && endsAt && new Date(startsAt) > new Date(endsAt)) {
    throw new Error("La fecha final del cupon no puede ser anterior a la fecha inicial.");
  }

  return {
    startsAt,
    endsAt,
  };
}

function getSalesCouponGrantedCredits(coupon: SalesCouponRow) {
  return Math.max(
    0,
    safeParseNumber(
      (coupon.granted_credits as number | string | null | undefined) ?? LEGACY_SALES_COUPON_GRANTED_CREDITS,
    ),
  );
}

function getSalesCouponType(coupon: SalesCouponRow): SalesCouponType {
  return normalizeSalesCouponType(coupon.coupon_type);
}

function getSalesCouponDiscountedPrice(coupon: SalesCouponRow) {
  return Math.max(
    0,
    safeParseNumber(
      (coupon.discounted_price as number | string | null | undefined) ?? LEGACY_SALES_COUPON_PRICE,
    ),
  );
}

function getSalesCouponPercentageOff(coupon: SalesCouponRow) {
  return normalizeCouponPercentageOff(coupon.percentage_off);
}

function isCouponCurrentlyActive(coupon: SalesCouponRow, now = new Date()) {
  const startsAt = coupon.starts_at ? new Date(coupon.starts_at) : null;
  const endsAt = coupon.ends_at ? new Date(coupon.ends_at) : null;

  if (!coupon.is_active) {
    return false;
  }

  if (startsAt && startsAt > now) {
    return false;
  }

  if (endsAt && endsAt < now) {
    return false;
  }

  return true;
}

function applyCouponTermsToProposal(proposal: SalesProposalRecord, coupon: SalesCouponRow): SalesProposalDraft {
  const couponType = getSalesCouponType(coupon);
  const percentageOff = couponType === "percentage" ? getSalesCouponPercentageOff(coupon) : null;
  const baseContractedCredits =
    proposal.appliedCouponId === coupon.id && proposal.couponBaseContractedCredits !== null
      ? proposal.couponBaseContractedCredits
      : proposal.contractedCredits;
  const baseQuotedPrice =
    proposal.appliedCouponId === coupon.id && proposal.couponBaseQuotedPrice !== null
      ? proposal.couponBaseQuotedPrice
      : proposal.quotedPrice;

  return {
    ...proposal,
    contractedCredits:
      couponType === "package_override" ? getSalesCouponGrantedCredits(coupon) : proposal.contractedCredits,
    quotedPrice:
      couponType === "package_override"
        ? getSalesCouponDiscountedPrice(coupon)
        : applyPercentageDiscount(baseQuotedPrice, percentageOff ?? 0),
    currency: resolveCurrency(proposal.currency),
    appliedCouponId: coupon.id,
    appliedCouponCode: normalizeSalesCouponCode(coupon.code),
    appliedCouponType: couponType,
    appliedCouponPercentageOff: percentageOff,
    couponBaseContractedCredits: baseContractedCredits,
    couponBaseQuotedPrice: baseQuotedPrice,
    couponAppliedAt: proposal.couponAppliedAt || new Date().toISOString(),
  };
}

function buildActivatedClientSlug(proposal: SalesProposalRecord, proposalId: string) {
  const baseSlug =
    proposal.slug?.trim() ||
    `${slugify(proposal.clientCompany || proposal.clientName || proposal.title)}-${proposalId.slice(0, 8)}`;

  return baseSlug.toLowerCase();
}

function getSalesProposalRouteBase(proposal: Pick<SalesProposalRecord, "workspaceVariant">) {
  return proposal.workspaceVariant === "dinterweb" ? "/sales/dinterweb/proposals" : "/sales/proposals";
}

export async function getActiveSalesCouponByCode(code: string) {
  const normalizedCode = normalizeSalesCouponCode(code);
  if (!normalizedCode) {
    return null;
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("sales_coupons")
    .select("*")
    .ilike("code", normalizedCode)
    .maybeSingle();
  const coupon = data as SalesCouponRow | null;

  if (error) {
    throw error;
  }

  if (!coupon || !isCouponCurrentlyActive(coupon)) {
    return null;
  }

  return coupon;
}

export async function createSalesCoupon(input: {
  code: string;
  couponType: SalesCouponType;
  grantedCredits: number;
  discountedPrice: number;
  percentageOff: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
  isActive?: boolean;
}) {
  const normalizedCode = normalizeSalesCouponCode(input.code);
  const couponType = normalizeSalesCouponType(input.couponType);
  const grantedCredits = Math.max(0, Math.round(safeParseNumber(input.grantedCredits)));
  const discountedPrice = Math.max(0, safeParseNumber(input.discountedPrice));
  const percentageOff =
    input.percentageOff === null || input.percentageOff === undefined
      ? null
      : normalizeCouponPercentageOff(input.percentageOff);
  const { startsAt, endsAt } = normalizeSalesCouponSchedule(input);
  const isActive = input.isActive ?? true;

  if (!normalizedCode) {
    throw new Error("Ingresa un codigo de cupon.");
  }

  if (couponType === "package_override" && grantedCredits <= 0) {
    throw new Error("Define una cantidad de creditos mayor a 0.");
  }

  if (couponType === "percentage" && (!percentageOff || percentageOff <= 0)) {
    throw new Error("Define un porcentaje de descuento mayor a 0.");
  }

  const admin = createSupabaseAdminClient();
  const { data: existingCoupon, error: existingError } = await admin
    .from("sales_coupons")
    .select("id")
    .ilike("code", normalizedCode)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existingCoupon) {
    throw new Error("Ya existe un cupon con ese codigo.");
  }

  const { data, error } = await admin
    .from("sales_coupons")
    .insert(({
      code: normalizedCode,
      coupon_type: couponType,
      granted_credits: couponType === "package_override" ? grantedCredits : 0,
      discounted_price: couponType === "package_override" ? discountedPrice : 0,
      percentage_off: couponType === "percentage" ? percentageOff : null,
      starts_at: startsAt,
      ends_at: endsAt,
      is_active: isActive,
    }) as never)
    .select("*")
    .single();
  const coupon = data as SalesCouponRow | null;

  if (error || !coupon) {
    throw error ?? new Error("No pudimos crear el cupon.");
  }

  return coupon;
}

async function getSalesCouponForProposal(row: SalesProposalRow, requireActive = true) {
  const admin = createSupabaseAdminClient();
  const appliedCouponId = row.applied_coupon_id;
  const appliedCouponCode = normalizeSalesCouponCode(row.applied_coupon_code ?? "");

  if (!appliedCouponId && !appliedCouponCode) {
    return null;
  }

  let query = admin.from("sales_coupons").select("*");

  if (appliedCouponId) {
    query = query.eq("id", appliedCouponId);
  } else {
    query = query.ilike("code", appliedCouponCode);
  }

  const { data, error } = await query.maybeSingle();
  const coupon = data as SalesCouponRow | null;

  if (error) {
    throw error;
  }

  if (!coupon) {
    return null;
  }

  if (requireActive && !isCouponCurrentlyActive(coupon)) {
    return null;
  }

  return coupon;
}

export async function saveSalesProposal(input: SalesProposalDraft, proposalSlug: string) {
  const admin = createSupabaseAdminClient();
  const loadExistingRow = async () => {
    const existing = await admin
      .from("sales_proposals")
      .select("*")
      .eq("slug", proposalSlug)
      .maybeSingle();

    if (existing.error) {
      throw existing.error;
    }

    return existing.data as SalesProposalRow | null;
  };

  let existingRow = await loadExistingRow();
  const draftToPersist = {
    ...input,
    slug: proposalSlug,
    // The seller no longer controls the CS assignment from the sales workspace.
    // Preserve the existing assignee unless another internal flow updates it explicitly.
    assignedCsmUserId: input.assignedCsmUserId || existingRow?.assigned_csm_user_id || "",
  };

  if (!isValidSalesProposalClientEmail(draftToPersist.clientEmail)) {
    throw new Error("Ingresa un correo valido del cliente antes de guardar la propuesta.");
  }

  const serialized = serializeSalesProposalDraft(draftToPersist);
  const fullSnapshot = serializeSalesProposalFullSnapshot(draftToPersist);
  const payload = ({
    slug: proposalSlug,
    ...serialized,
  }) as never;
  const runWrite = (row: SalesProposalRow | null) =>
    (row
      ? admin.from("sales_proposals").update(payload).eq("id", row.id)
      : admin.from("sales_proposals").insert(payload))
      .select("*")
      .single();
  let { data, error } = await runWrite(existingRow);

  if ((error || !data) && !existingRow && isSalesProposalSlugConflict(error)) {
    existingRow = await loadExistingRow();

    if (existingRow) {
      ({ data, error } = await runWrite(existingRow));
    }
  }

  if (error || !data) {
    console.error("sales_proposal_save_failed", {
      slug: proposalSlug,
      existingProposalId: existingRow?.id ?? null,
      initiativeCount: draftToPersist.initiatives.length,
      payloadSize: JSON.stringify(payload).length,
      error,
    });
    throw error ?? new Error("No pudimos guardar la propuesta comercial.");
  }

  const typedRow = data as SalesProposalRow;
  const { error: snapshotError } = await admin.from("sales_proposal_snapshots").upsert(({
    proposal_id: typedRow.id,
    snapshot: fullSnapshot,
    updated_at: new Date().toISOString(),
  }) as never);

  if (snapshotError) {
    if (isMissingSupabaseTable(snapshotError, "sales_proposal_snapshots")) {
      throw new Error("Falta aplicar la migracion de snapshots de propuestas comerciales.");
    }

    throw snapshotError;
  }

  return mapSalesProposalRow(attachSalesProposalSnapshot(typedRow, fullSnapshot));
}

export async function applySalesCouponToProposal(proposalSlug: string, couponCode: string) {
  const admin = createSupabaseAdminClient();
  const { data: proposalRow, error } = await admin
    .from("sales_proposals")
    .select("*")
    .eq("slug", proposalSlug)
    .maybeSingle();
  const typedProposalRow = proposalRow as SalesProposalRow | null;

  if (error || !typedProposalRow) {
    throw error ?? new Error("No encontramos la propuesta comercial.");
  }

  if (
    typedProposalRow.status === "checkout_pending" ||
    typedProposalRow.status === "transfer_pending" ||
    typedProposalRow.status === "paid" ||
    typedProposalRow.status === "board_activated"
  ) {
    throw new Error("El cupon solo se puede aplicar antes de iniciar el checkout.");
  }

  const coupon = await getActiveSalesCouponByCode(couponCode);

  if (!coupon) {
    throw new Error("El cupon no existe o ya no esta activo.");
  }

  const proposal = await mapSalesProposalRecord(typedProposalRow);
  const nextProposal = applyCouponTermsToProposal(proposal, coupon);

  return saveSalesProposal(nextProposal, proposalSlug);
}

export async function removeSalesCouponFromProposal(proposalSlug: string) {
  const admin = createSupabaseAdminClient();
  const { data: proposalRow, error } = await admin
    .from("sales_proposals")
    .select("*")
    .eq("slug", proposalSlug)
    .maybeSingle();
  const typedProposalRow = proposalRow as SalesProposalRow | null;

  if (error || !typedProposalRow) {
    throw error ?? new Error("No encontramos la propuesta comercial.");
  }

  if (
    typedProposalRow.status === "checkout_pending" ||
    typedProposalRow.status === "transfer_pending" ||
    typedProposalRow.status === "paid" ||
    typedProposalRow.status === "board_activated"
  ) {
    throw new Error("El cupon solo se puede quitar antes de iniciar el checkout.");
  }

  const proposal = await mapSalesProposalRecord(typedProposalRow);

  if (!proposal.appliedCouponCode.trim()) {
    throw new Error("La propuesta no tiene un cupon aplicado.");
  }

  const restoredCredits =
    proposal.appliedCouponType === "package_override"
      ? proposal.couponBaseContractedCredits ?? SALES_PROPOSAL_BASE_CREDITS
      : proposal.contractedCredits;
  const restoredQuotedPrice =
    proposal.appliedCouponType === "package_override"
      ? proposal.couponBaseQuotedPrice ?? SALES_PROPOSAL_BASE_PRICE
      : proposal.appliedCouponType === "percentage" && proposal.couponBaseQuotedPrice !== null
        ? proposal.couponBaseQuotedPrice
        : proposal.quotedPrice;

  return saveSalesProposal(
    {
      ...proposal,
      contractedCredits: restoredCredits,
      quotedPrice: restoredQuotedPrice,
      appliedCouponId: null,
      appliedCouponCode: "",
      appliedCouponType: null,
      appliedCouponPercentageOff: null,
      couponBaseContractedCredits: null,
      couponBaseQuotedPrice: null,
      couponAppliedAt: null,
    },
    proposalSlug,
  );
}

export async function updateSalesProposalProspectExtraPackages(
  proposalSlug: string,
  quantity: number,
) {
  const admin = createSupabaseAdminClient();
  const { data: proposalRow, error } = await admin
    .from("sales_proposals")
    .select("*")
    .eq("slug", proposalSlug)
    .maybeSingle();
  const typedProposalRow = proposalRow as SalesProposalRow | null;

  if (error || !typedProposalRow) {
    throw error ?? new Error("No encontramos la propuesta comercial.");
  }

  if (
    typedProposalRow.status === "checkout_pending" ||
    typedProposalRow.status === "transfer_pending" ||
    typedProposalRow.status === "paid" ||
    typedProposalRow.status === "board_activated"
  ) {
    throw new Error("Los paquetes extra solo se pueden ajustar antes de iniciar el checkout.");
  }

  const proposal = await mapSalesProposalRecord(typedProposalRow);
  const nextProposal = setSalesProposalExtraPackages(
    proposal,
    PUBLIC_EXTRA_CREDIT_PACKAGE,
    quantity,
  );

  return saveSalesProposal(nextProposal, proposalSlug);
}

async function setSalesProposalTransferPending(proposal: SalesProposalRecord) {
  if (!proposal.id) {
    throw new Error("La propuesta debe guardarse antes de enviarla a Finanzas.");
  }

  const activationValidation = getSalesProposalActivationValidation(proposal);
  if (!activationValidation.isValid) {
    throw new Error(activationValidation.message || "La propuesta aun no esta lista para enviarse a Finanzas.");
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("sales_proposals")
    .update(({
      status: "transfer_pending",
      payment_method: "bank_transfer",
      stripe_checkout_session_id: null,
      stripe_payment_intent_id: null,
      stripe_subscription_id: null,
      transfer_bank: null,
      transfer_reference: null,
      transfer_validated_at: null,
      transfer_validated_by_user_id: null,
      updated_at: new Date().toISOString(),
    }) as never)
    .eq("id", proposal.id)
    .select("*")
    .single();
  const typedRow = data as SalesProposalRow | null;

  if (error || !typedRow) {
    throw error ?? new Error("No pudimos enviar la propuesta a revision de Finanzas.");
  }

  return mapSalesProposalRecord(typedRow);
}

async function activateSalesProposalFromCoupon(
  proposal: SalesProposalRecord,
  appliedCouponOverride?: SalesCouponRow | null,
) {
  const appliedCouponCode = normalizeSalesCouponCode(proposal.appliedCouponCode);

  if (!appliedCouponCode && !appliedCouponOverride) {
    throw new Error("No hay un cupon aplicado en la propuesta.");
  }

  const appliedCoupon =
    appliedCouponOverride ?? (appliedCouponCode ? await getActiveSalesCouponByCode(appliedCouponCode) : null);

  if (!appliedCoupon) {
    throw new Error("El cupon aplicado ya no esta activo.");
  }

  if (!proposal.id) {
    throw new Error("La propuesta debe guardarse antes de activar el cupon.");
  }

  const syncedProposal = await saveSalesProposal(
    applyCouponTermsToProposal(proposal, appliedCoupon),
    proposal.slug || proposal.id,
  );

  await activateSalesProposalWithPaymentContext(syncedProposal.id!, {
    paymentMethod: syncedProposal.paymentMethod,
    checkoutSessionId: null,
    paymentIntentId: null,
    subscriptionId: null,
    invoiceId: null,
    amountCents: 0,
    currency: resolveCurrency(syncedProposal.currency),
  });

  if (appliedCoupon.is_active) {
    const { error: deactivateCouponError } = await createSupabaseAdminClient()
      .from("sales_coupons")
      .update(({
        is_active: false,
        updated_at: new Date().toISOString(),
      }) as never)
      .eq("id", appliedCoupon.id);

    if (deactivateCouponError) {
      throw deactivateCouponError;
    }
  }

  const admin = createSupabaseAdminClient();
  const { data: refreshedRow, error } = await admin
    .from("sales_proposals")
    .select("*")
    .eq("id", syncedProposal.id!)
    .single();
  const typedRefreshedRow = refreshedRow as SalesProposalRow | null;

  if (error || !typedRefreshedRow) {
    throw error ?? new Error("No pudimos refrescar la propuesta activada con cupon.");
  }

  return mapSalesProposalRecord(typedRefreshedRow);
}

export async function activateSalesProposal(
  request: Request,
  proposal: SalesProposalRecord,
  checkoutOptions: SalesProposalCheckoutOptions = {},
): Promise<SalesProposalActivationResult> {
  const appliedCouponCode = normalizeSalesCouponCode(proposal.appliedCouponCode);

  if (!appliedCouponCode) {
    return { url: await createSalesProposalCheckout(request, proposal, checkoutOptions) };
  }

  if (proposal.quotedPrice > 0) {
    if (proposal.paymentMethod === "bank_transfer") {
      const transferPendingProposal = await setSalesProposalTransferPending(proposal);

      return {
        proposal: transferPendingProposal,
        message: "La propuesta se envio a Finanzas para validar la transferencia antes de asignar CS.",
      };
    }

    return { url: await createSalesProposalCheckout(request, proposal, checkoutOptions) };
  }

  const refreshedProposal = await activateSalesProposalFromCoupon(proposal);

  return {
    proposal: refreshedProposal,
    message:
      refreshedProposal.status === "board_activated"
        ? "Plan activado con cupon sin pasar por la pasarela de pago."
        : "Cupon usado. La propuesta quedo en $0, se marco como pagada y espera la asignacion de CS.",
  };
}

type SalesProposalCheckoutOptions = {
  successUrl?: string;
  cancelUrl?: string;
};

export async function createSalesProposalCheckout(
  request: Request,
  proposal: SalesProposalRecord,
  options: SalesProposalCheckoutOptions = {},
) {
  const proposalId = proposal.id;
  if (!proposalId) {
    throw new Error("La propuesta debe guardarse antes de activar el checkout.");
  }

  const activationValidation = getSalesProposalActivationValidation(proposal);
  if (!activationValidation.isValid) {
    throw new Error(activationValidation.message || "La propuesta aun no esta lista para activarse.");
  }

  const admin = createSupabaseAdminClient();
  const stripe = getStripe();
  const origin = resolveOrigin(request);
  const amountInCents = Math.round(proposal.quotedPrice * 100);
  const routeBase = getSalesProposalRouteBase(proposal);

  const baseMetadata = {
    sales_proposal_id: proposal.id || "",
    sales_proposal_slug: proposal.slug || "",
    sales_client_name: proposal.clientName,
    sales_workspace_variant: proposal.workspaceVariant || "hubspot",
  };
  const isRecurringProposal = proposal.billingMode === "subscription";

  const session = await stripe.checkout.sessions.create({
    mode: isRecurringProposal ? "subscription" : "payment",
    ...(isRecurringProposal ? {} : { submit_type: "pay" as const }),
    customer_email: proposal.clientEmail || undefined,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: resolveCurrency(proposal.currency),
          unit_amount: amountInCents,
          ...(isRecurringProposal
            ? {
                recurring: {
                  interval: "month" as const,
                  interval_count: proposal.periodMonths,
                },
              }
            : {}),
          product_data: {
            name: `${proposal.clientCompany || proposal.clientName} · Activar plan`,
            description: `${proposal.contractedCredits} CR · ${proposal.title}`,
          },
        },
      },
    ],
    consent_collection: {
      terms_of_service: "required",
    },
    success_url:
      options.successUrl ||
      `${origin}${routeBase}/${proposal.slug}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: options.cancelUrl || `${origin}${routeBase}/${proposal.slug}?payment=cancelled`,
    metadata: baseMetadata,
    ...(isRecurringProposal
      ? {
          subscription_data: {
            metadata: {
              sales_proposal_id: proposal.id || "",
              sales_proposal_slug: proposal.slug || "",
            },
          },
        }
      : {
          payment_intent_data: {
            metadata: {
              sales_proposal_id: proposal.id || "",
              sales_proposal_slug: proposal.slug || "",
            },
          },
        }),
  });

  const { error } = await admin
    .from("sales_proposals")
    .update(({
      status: "checkout_pending",
      payment_method: "stripe",
      transfer_bank: null,
      stripe_checkout_session_id: session.id,
      transfer_reference: null,
      transfer_validated_at: null,
      transfer_validated_by_user_id: null,
      updated_at: new Date().toISOString(),
    }) as never)
    .eq("id", proposalId);

  if (error) {
    throw error;
  }

  if (!session.url) {
    throw new Error("No pudimos generar el checkout del cliente.");
  }

  return session.url;
}

async function activateSalesProposalWithPaymentContext(
  proposalId: string,
  payment: SalesProposalPaymentContext,
  updateSubscriptionMetadata?: (activatedClientId: string) => Promise<void>,
) {
  const admin = createSupabaseAdminClient();
  const { data: proposalRow, error: proposalError } = await admin
    .from("sales_proposals")
    .select("*")
    .eq("id", proposalId)
    .single();
  const typedProposalRow = proposalRow as SalesProposalRow | null;

  if (proposalError || !typedProposalRow) {
    throw proposalError ?? new Error("No encontramos la propuesta comercial pagada.");
  }

  const proposal = await mapSalesProposalRecord(typedProposalRow);
  const mappedProposalId = proposal.id;
  if (!mappedProposalId) {
    throw new Error("La propuesta pagada no tiene un identificador valido.");
  }
  const subscriptionId = payment.subscriptionId;
  const paymentIntentId = payment.paymentIntentId;
  let activatedClientId = proposal.activatedClientId;

  if (!activatedClientId) {
    if (!proposal.assignedCsmUserId) {
      const { error: paidUpdateError } = await admin
        .from("sales_proposals")
        .update(({
          status: "paid",
          payment_method: payment.paymentMethod ?? normalizeSalesPaymentMethod(typedProposalRow.payment_method),
          paid_at: new Date().toISOString(),
          stripe_checkout_session_id: payment.checkoutSessionId,
          stripe_payment_intent_id: paymentIntentId,
          stripe_subscription_id: subscriptionId,
          transfer_bank: payment.transferBank ?? typedProposalRow.transfer_bank,
          transfer_reference: payment.transferReference ?? typedProposalRow.transfer_reference,
          transfer_validated_at: payment.transferValidatedAt ?? typedProposalRow.transfer_validated_at,
          transfer_validated_by_user_id:
            payment.transferValidatedByUserId ?? typedProposalRow.transfer_validated_by_user_id,
          updated_at: new Date().toISOString(),
        }) as never)
        .eq("id", mappedProposalId);

      if (paidUpdateError) {
        throw paidUpdateError;
      }

      return;
    }

    const clientSlug = buildActivatedClientSlug(proposal, mappedProposalId);
    const { data: existingClientBySlug, error: existingClientError } = await admin
      .from("clients")
      .select("*")
      .eq("slug", clientSlug)
      .maybeSingle();
    const typedExistingClient = existingClientBySlug as ClientRow | null;

    if (existingClientError) {
      throw existingClientError;
    }

    if (typedExistingClient) {
      const { error: existingClientUpdateError } = await admin
        .from("clients")
        .update(({
          owner_user_id: proposal.assignedCsmUserId,
          seller_user_id: null,
          csm_user_id: proposal.assignedCsmUserId,
          name: proposal.clientCompany || proposal.clientName,
          description: proposal.clientDescription || proposal.title,
          updated_at: new Date().toISOString(),
        }) as never)
        .eq("id", typedExistingClient.id);

      if (existingClientUpdateError) {
        throw existingClientUpdateError;
      }

      activatedClientId = typedExistingClient.id;
    } else {
      const { data: insertedClient, error: clientError } = await admin
        .from("clients")
        .insert(({
          owner_user_id: proposal.assignedCsmUserId,
          seller_user_id: null,
          csm_user_id: proposal.assignedCsmUserId,
          name: proposal.clientCompany || proposal.clientName,
          slug: clientSlug,
          description: proposal.clientDescription || proposal.title,
        }) as never)
        .select("*")
        .single();
      const typedInsertedClient = insertedClient as ClientRow | null;

      if (clientError) {
        const duplicateSlugConflict =
          typeof clientError === "object" &&
          clientError !== null &&
          "code" in clientError &&
          clientError.code === "23505";

        if (!duplicateSlugConflict) {
          throw clientError;
        }

        const { data: conflictingClient, error: conflictingClientError } = await admin
          .from("clients")
          .select("*")
          .eq("slug", clientSlug)
          .maybeSingle();
        const typedConflictingClient = conflictingClient as ClientRow | null;

        if (conflictingClientError || !typedConflictingClient) {
          throw conflictingClientError ?? clientError;
        }

        activatedClientId = typedConflictingClient.id;
      } else if (!typedInsertedClient) {
        throw new Error("No pudimos crear el cliente para Customer Success.");
      } else {
        activatedClientId = typedInsertedClient.id;
      }
    }

    const { error: proposalClientLinkError } = await admin
      .from("sales_proposals")
      .update(({
        activated_client_id: activatedClientId,
        updated_at: new Date().toISOString(),
      }) as never)
      .eq("id", mappedProposalId);

    if (proposalClientLinkError) {
      throw proposalClientLinkError;
    }

    const { error: configError } = await admin.from("onboarding_configs").upsert(({
      client_id: activatedClientId,
      start_date: proposal.startDate || toIsoDate(),
      base_capacity: proposal.contractedCredits,
      custom_plan_credits: proposal.contractedCredits,
      custom_plan_price: proposal.quotedPrice,
      custom_plan_type: proposal.billingMode === "subscription" ? "mensual" : "proyecto",
      custom_plan_billing_mode: proposal.billingMode,
      custom_plan_period_months: proposal.periodMonths,
      current_stage: "cs",
      credit_validity_days: proposal.creditValidityDays,
      sales_cleared: true,
      updated_by_user_id: proposal.assignedCsmUserId,
    }) as never, {
      onConflict: "client_id",
    });

    if (configError) {
      throw configError;
    }
  }

  if (payment.recordStripePayment !== false) {
    const paymentArgs: RecordStripeCheckoutPaymentArgs = {
      p_client_id: activatedClientId,
      p_checkout_session_id: payment.checkoutSessionId,
      p_payment_intent_id: paymentIntentId,
      p_amount_cents: payment.amountCents,
      p_currency: resolveCurrency(payment.currency || proposal.currency),
      p_stripe_subscription_id: subscriptionId,
      p_stripe_invoice_id: payment.invoiceId,
    };

    const { error: paymentError } = await admin.rpc(
      "record_stripe_checkout_payment" as never,
      paymentArgs as never,
    );

    if (paymentError) {
      throw paymentError;
    }
  } else if ((payment.paymentMethod ?? normalizeSalesPaymentMethod(typedProposalRow.payment_method)) === "bank_transfer") {
    await recordManualTransferBillingCycles({
      clientId: activatedClientId,
      proposalId: mappedProposalId,
      cycleStartDate: payment.transferValidatedAt?.slice(0, 10) || toIsoDate(),
      transferBank: payment.transferBank ?? typedProposalRow.transfer_bank ?? "",
      transferReference: payment.transferReference ?? typedProposalRow.transfer_reference ?? "",
      validatedAt: payment.transferValidatedAt ?? new Date().toISOString(),
      validatedByUserId:
        payment.transferValidatedByUserId ?? typedProposalRow.transfer_validated_by_user_id ?? "",
      amountCents: payment.amountCents,
      currency: resolveCurrency(payment.currency || proposal.currency),
    });
  }

  if (subscriptionId && updateSubscriptionMetadata) {
    await updateSubscriptionMetadata(activatedClientId);
  }

  const { count: existingInitiativesCount, error: existingInitiativesError } = await admin
    .from("onboarding_initiatives")
    .select("id", { count: "exact", head: true })
    .eq("client_id", activatedClientId);

  if (existingInitiativesError) {
    throw existingInitiativesError;
  }

  if (proposal.assignedCsmUserId && !existingInitiativesCount) {
    for (const [initiativeIndex, initiative] of proposal.initiatives.entries()) {
      const { data: insertedInitiative, error: initiativeError } = await admin
        .from("onboarding_initiatives")
        .insert(({
          client_id: activatedClientId,
          title: initiative.title,
          type: initiative.type || null,
          status: initiative.status,
          description: initiative.description || null,
          est_start_date: initiative.estStartDate || null,
          est_end_date: initiative.estEndDate || null,
          date_planned: proposal.startDate || null,
          labels: [
            initiative.validationStatus === "validated"
              ? "Validado"
              : initiative.validationStatus === "reviewing"
                ? "En revisión"
                : null,
            initiative.commerciallyWaived ? "Bonificado comercialmente" : null,
          ].filter(Boolean),
          last_activity: toIsoDate(),
          is_blocked: initiative.isBlocked,
          sort_order: initiative.sortOrder ?? initiativeIndex,
          owner_csm: proposal.assignedCsmUserId,
          created_by_user_id: proposal.assignedCsmUserId,
          updated_by_user_id: proposal.assignedCsmUserId,
        }) as never)
        .select("*")
        .single();
      const typedInsertedInitiative = insertedInitiative as OnboardingInitiativeRow | null;

      if (initiativeError || !typedInsertedInitiative) {
        throw initiativeError ?? new Error("No pudimos crear las iniciativas vendidas.");
      }

      if (initiative.subitems.length) {
        const subitemRows = initiative.subitems.map((subitem, subitemIndex) => ({
          initiative_id: typedInsertedInitiative.id,
          catalog_item_id: subitem.catalogItemId,
          name: subitem.name,
          status: subitem.status,
          target_date: subitem.targetDate || null,
          unit_credits: initiative.commerciallyWaived ? 0 : subitem.unitCredits,
          quantity: subitem.quantity,
          sort_order: subitemIndex,
        }));

        const { error: subitemsError } = await admin
          .from("onboarding_initiative_subitems")
          .insert(subitemRows as never);

        if (subitemsError) {
          throw subitemsError;
        }
      }

      await admin.from("onboarding_activity_logs").insert(({
        initiative_id: typedInsertedInitiative.id,
        entry: initiative.commerciallyWaived
          ? "Iniciativa activada desde la plataforma comercial como bonificacion sin consumo de creditos."
          : "Iniciativa activada desde la plataforma comercial.",
        created_by_user_id: proposal.assignedCsmUserId,
      }) as never);
    }
  }

  const { error: updateError } = await admin
    .from("sales_proposals")
    .update(({
      status: "board_activated",
      payment_method: payment.paymentMethod ?? normalizeSalesPaymentMethod(typedProposalRow.payment_method),
      activated_client_id: activatedClientId,
      activated_at: new Date().toISOString(),
      paid_at: new Date().toISOString(),
      stripe_checkout_session_id: payment.checkoutSessionId,
      stripe_payment_intent_id: paymentIntentId,
      stripe_subscription_id: subscriptionId,
      transfer_bank: payment.transferBank ?? typedProposalRow.transfer_bank,
      transfer_reference: payment.transferReference ?? typedProposalRow.transfer_reference,
      transfer_validated_at: payment.transferValidatedAt ?? typedProposalRow.transfer_validated_at,
      transfer_validated_by_user_id:
        payment.transferValidatedByUserId ?? typedProposalRow.transfer_validated_by_user_id,
      updated_at: new Date().toISOString(),
    }) as never)
    .eq("id", mappedProposalId);

  if (updateError) {
    throw updateError;
  }
}

export async function activateSalesProposalAfterPayment(
  stripe: Stripe,
  proposalId: string,
  session: Stripe.Checkout.Session,
) {
  const subscriptionId =
    typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;

  await activateSalesProposalWithPaymentContext(
    proposalId,
    {
      paymentMethod: "stripe",
      checkoutSessionId: session.id,
      paymentIntentId:
        typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null,
      subscriptionId,
      invoiceId: typeof session.invoice === "string" ? session.invoice : session.invoice?.id ?? null,
      amountCents: session.amount_total ?? 0,
      currency: session.currency ?? "usd",
    },
    subscriptionId
      ? async (activatedClientId) => {
          await stripe.subscriptions.update(subscriptionId, {
            metadata: {
              client_id: activatedClientId,
              sales_proposal_id: proposalId,
            },
          });
        }
      : undefined,
  );
}

export async function activatePaidSalesProposalAfterAssignment(proposalId: string) {
  const admin = createSupabaseAdminClient();
  const { data: proposalRow, error } = await admin
    .from("sales_proposals")
    .select("*")
    .eq("id", proposalId)
    .maybeSingle();
  const typedProposalRow = proposalRow as SalesProposalRow | null;

  if (error || !typedProposalRow) {
    throw error ?? new Error("No encontramos la propuesta pagada.");
  }

  const storedCoupon = await getSalesCouponForProposal(typedProposalRow, false);

  if (storedCoupon && getSalesCouponDiscountedPrice(storedCoupon) <= 0) {
    await activateSalesProposalFromCoupon(await mapSalesProposalRecord(typedProposalRow), storedCoupon);
    return;
  }

  if (normalizeSalesPaymentMethod(typedProposalRow.payment_method) === "bank_transfer") {
    await activateSalesProposalWithPaymentContext(proposalId, {
      paymentMethod: "bank_transfer",
      checkoutSessionId: null,
      paymentIntentId: null,
      subscriptionId: null,
      invoiceId: null,
      amountCents: Math.round(safeParseNumber(typedProposalRow.quoted_price) * 100),
      currency: typedProposalRow.currency,
      transferBank: typedProposalRow.transfer_bank,
      transferReference: typedProposalRow.transfer_reference,
      transferValidatedAt: typedProposalRow.transfer_validated_at,
      transferValidatedByUserId: typedProposalRow.transfer_validated_by_user_id,
      recordStripePayment: false,
    });
    return;
  }

  if (!typedProposalRow.stripe_checkout_session_id) {
    throw new Error("La propuesta pagada no tiene una sesion de Stripe para activar el cliente.");
  }

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(typedProposalRow.stripe_checkout_session_id, {
    expand: ["invoice", "subscription"],
  });

  await activateSalesProposalAfterPayment(stripe, proposalId, session);
}

export async function confirmTransferredSalesProposalPayment(
  proposalId: string,
  transferBank: string,
  transferReference: string,
  validatedByUserId: string,
) {
  const normalizedBank = transferBank.trim();
  const normalizedReference = transferReference.trim();
  if (!normalizedBank) {
    throw new Error("Ingresa el banco antes de confirmar el pago.");
  }

  if (!normalizedReference) {
    throw new Error("Ingresa la referencia de la transferencia antes de confirmar el pago.");
  }

  const admin = createSupabaseAdminClient();
  const { data: proposalRow, error } = await admin
    .from("sales_proposals")
    .select("*")
    .eq("id", proposalId)
    .maybeSingle();
  const typedProposalRow = proposalRow as SalesProposalRow | null;

  if (error || !typedProposalRow) {
    throw error ?? new Error("No encontramos la propuesta por transferencia.");
  }

  if (normalizeSalesPaymentMethod(typedProposalRow.payment_method) !== "bank_transfer") {
    throw new Error("Esta propuesta no usa transferencia como metodo de pago.");
  }

  if (typedProposalRow.status !== "transfer_pending") {
    throw new Error("La propuesta ya no esta pendiente de validacion financiera.");
  }

  const validatedAt = new Date().toISOString();

  await activateSalesProposalWithPaymentContext(proposalId, {
    paymentMethod: "bank_transfer",
    checkoutSessionId: null,
    paymentIntentId: null,
    subscriptionId: null,
    invoiceId: null,
    amountCents: Math.round(safeParseNumber(typedProposalRow.quoted_price) * 100),
    currency: typedProposalRow.currency,
    transferBank: normalizedBank,
    transferReference: normalizedReference,
    transferValidatedAt: validatedAt,
    transferValidatedByUserId: validatedByUserId,
    recordStripePayment: false,
  });

  const { data: refreshedRow, error: refreshedError } = await admin
    .from("sales_proposals")
    .select("*")
    .eq("id", proposalId)
    .single();
  const typedRefreshedRow = refreshedRow as SalesProposalRow | null;

  if (refreshedError || !typedRefreshedRow) {
    throw refreshedError ?? new Error("No pudimos refrescar la propuesta despues de validar la transferencia.");
  }

  return mapSalesProposalRecord(typedRefreshedRow);
}

export async function confirmTransferredSalesProposalRenewalPayment(
  proposalId: string,
  cycleStartDate: string,
  transferBank: string,
  transferReference: string,
  validatedByUserId: string,
) {
  const normalizedBank = transferBank.trim();
  const normalizedReference = transferReference.trim();
  const normalizedCycleStartDate = cycleStartDate.trim();

  if (!normalizedBank) {
    throw new Error("Ingresa el banco antes de confirmar el pago.");
  }

  if (!normalizedReference) {
    throw new Error("Ingresa la referencia de la transferencia antes de confirmar el pago.");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedCycleStartDate)) {
    throw new Error("La renovacion no tiene una fecha de ciclo valida.");
  }

  const admin = createSupabaseAdminClient();
  const { data: proposalRow, error } = await admin
    .from("sales_proposals")
    .select("*")
    .eq("id", proposalId)
    .maybeSingle();
  const typedProposalRow = proposalRow as SalesProposalRow | null;

  if (error || !typedProposalRow) {
    throw error ?? new Error("No encontramos la suscripcion por transferencia.");
  }

  if (normalizeSalesPaymentMethod(typedProposalRow.payment_method) !== "bank_transfer") {
    throw new Error("Esta venta no usa transferencia como metodo de pago.");
  }

  if (typedProposalRow.billing_mode !== "subscription") {
    throw new Error("Solo las suscripciones pueden generar renovaciones manuales.");
  }

  if (typedProposalRow.status !== "board_activated" || !typedProposalRow.activated_client_id) {
    throw new Error("La suscripcion debe estar activa antes de registrar una renovacion.");
  }

  const validatedAt = new Date().toISOString();

  await recordManualTransferBillingCycles({
    clientId: typedProposalRow.activated_client_id,
    proposalId,
    cycleStartDate: normalizedCycleStartDate,
    transferBank: normalizedBank,
    transferReference: normalizedReference,
    validatedAt,
    validatedByUserId,
    amountCents: Math.round(safeParseNumber(typedProposalRow.quoted_price) * 100),
    currency: typedProposalRow.currency,
  });

  const { error: proposalUpdateError } = await admin
    .from("sales_proposals")
    .update(({
      transfer_bank: normalizedBank,
      transfer_reference: normalizedReference,
      transfer_validated_at: validatedAt,
      transfer_validated_by_user_id: validatedByUserId,
      updated_at: validatedAt,
    }) as never)
    .eq("id", proposalId);

  if (proposalUpdateError) {
    throw proposalUpdateError;
  }

  const refreshedProposal = await mapSalesProposalRecord(typedProposalRow);
  return {
    ...refreshedProposal,
    message: "Renovacion por transferencia confirmada y creditos recargados.",
  };
}

export async function syncSalesProposalCheckoutStatus(
  proposalSlug: string,
  sessionId?: string | null,
) {
  const admin = createSupabaseAdminClient();
  const { data: proposalRow, error } = await admin
    .from("sales_proposals")
    .select("*")
    .eq("slug", proposalSlug)
    .maybeSingle();
  const typedProposalRow = proposalRow as SalesProposalRow | null;

  if (error || !typedProposalRow) {
    throw error ?? new Error("No encontramos la propuesta comercial.");
  }

  const currentProposal = await mapSalesProposalRecord(typedProposalRow);
  if (currentProposal.status !== "checkout_pending") {
    return currentProposal;
  }

  const checkoutSessionId = sessionId || typedProposalRow.stripe_checkout_session_id;
  if (!checkoutSessionId) {
    return currentProposal;
  }

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(checkoutSessionId, {
    expand: ["invoice", "subscription"],
  });
  const matchesProposal =
    session.metadata?.sales_proposal_id === currentProposal.id ||
    session.metadata?.sales_proposal_slug === proposalSlug;

  if (!matchesProposal) {
    throw new Error("La sesion de pago no pertenece a esta propuesta.");
  }

  if (session.payment_status !== "paid") {
    return currentProposal;
  }

  if (!currentProposal.id) {
    throw new Error("La propuesta no tiene un identificador valido para sincronizar el pago.");
  }

  await activateSalesProposalAfterPayment(stripe, currentProposal.id, session);

  const { data: refreshedRow, error: refreshedError } = await admin
    .from("sales_proposals")
    .select("*")
    .eq("slug", proposalSlug)
    .maybeSingle();
  const typedRefreshedRow = refreshedRow as SalesProposalRow | null;

  if (refreshedError || !typedRefreshedRow) {
    throw refreshedError ?? new Error("No pudimos refrescar la propuesta despues del pago.");
  }

  return mapSalesProposalRecord(typedRefreshedRow);
}
