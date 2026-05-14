import Stripe from "stripe";

import {
  createHubSpotDeal,
  isHubSpotConfigured,
  moveHubSpotDealToWon,
  updateHubSpotDeal,
} from "@/lib/hubspot";
import {
  getSalesProposalActivationValidation,
  mapSalesProposalRow,
  serializeSalesProposalDraft,
  type SalesProposalDraft,
  type SalesProposalRecord,
} from "@/lib/sales-proposals";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { slugify, toIsoDate } from "@/lib/utils";
import type { Database } from "@/types/database";

type RecordStripeCheckoutPaymentArgs =
  Database["public"]["Functions"]["record_stripe_checkout_payment"]["Args"];
type SalesProposalRow = Database["public"]["Tables"]["sales_proposals"]["Row"];
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
  checkoutSessionId: string | null;
  paymentIntentId: string | null;
  subscriptionId: string | null;
  invoiceId: string | null;
  amountCents: number;
  currency: string;
};

const SALES_COUPON_GRANTED_CREDITS = 40;
const SALES_COUPON_PRICE = 0;

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

function normalizeSalesCouponCode(value: string) {
  return value.trim().toUpperCase();
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
  return {
    ...proposal,
    contractedCredits: SALES_COUPON_GRANTED_CREDITS,
    quotedPrice: SALES_COUPON_PRICE,
    currency: resolveCurrency(proposal.currency),
    billingMode: "one_time",
    periodMonths: 1,
    appliedCouponId: coupon.id,
    appliedCouponCode: coupon.code,
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
  const existing = await admin
    .from("sales_proposals")
    .select("*")
    .eq("slug", proposalSlug)
    .maybeSingle();
  const existingRow = existing.data as SalesProposalRow | null;
  const draftToPersist = {
    ...input,
    slug: proposalSlug,
    // The seller no longer controls the CS assignment from the sales workspace.
    // Preserve the existing assignee unless another internal flow updates it explicitly.
    assignedCsmUserId: input.assignedCsmUserId || existingRow?.assigned_csm_user_id || "",
  };
  const serialized = serializeSalesProposalDraft(draftToPersist);

  let hubspotDealId: string | null = existingRow?.hubspot_deal_id ?? null;

  if (isHubSpotConfigured()) {
    if (hubspotDealId) {
      await updateHubSpotDeal(hubspotDealId, {
        dealname: serialized.title,
        amount: String(serialized.quoted_price),
        description: `Everboarding proposal ${proposalSlug} · ${serialized.client_name}${serialized.client_company ? ` · ${serialized.client_company}` : ""}${serialized.client_email ? ` · ${serialized.client_email}` : ""}`,
      });
    } else {
      const deal = await createHubSpotDeal({
        dealName: serialized.title,
        amount: serialized.quoted_price,
        pipelineId: process.env.HUBSPOT_SALES_PIPELINE_ID ?? null,
        dealStageId: process.env.HUBSPOT_DEAL_STAGE_NEW_ID ?? null,
        closeDate: serialized.start_date,
        proposalSlug: proposalSlug,
        clientName: serialized.client_name,
        clientEmail: serialized.client_email,
        clientCompany: serialized.client_company,
      });
      hubspotDealId = deal?.id ?? null;
    }
  }

  const { data, error } = await admin
    .from("sales_proposals")
    .upsert(
      ({
        slug: proposalSlug,
        ...serialized,
        hubspot_deal_id: hubspotDealId,
        hubspot_pipeline_id: process.env.HUBSPOT_SALES_PIPELINE_ID ?? null,
        hubspot_deal_stage_id: process.env.HUBSPOT_DEAL_STAGE_NEW_ID ?? null,
        last_synced_at: new Date().toISOString(),
      }) as never,
      { onConflict: "slug" },
    )
    .select("*")
    .single();

  if (error || !data) {
    throw error ?? new Error("No pudimos guardar la propuesta comercial.");
  }

  return mapSalesProposalRow(data as SalesProposalRow);
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
    typedProposalRow.status === "paid" ||
    typedProposalRow.status === "board_activated"
  ) {
    throw new Error("El cupon solo se puede aplicar antes de iniciar el checkout.");
  }

  const coupon = await getActiveSalesCouponByCode(couponCode);

  if (!coupon) {
    throw new Error("El cupon no existe o ya no esta activo.");
  }

  const proposal = mapSalesProposalRow(typedProposalRow);
  const nextProposal = applyCouponTermsToProposal(proposal, coupon);

  return saveSalesProposal(nextProposal, proposalSlug);
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

  return mapSalesProposalRow(typedRefreshedRow);
}

export async function activateSalesProposal(
  request: Request,
  proposal: SalesProposalRecord,
): Promise<SalesProposalActivationResult> {
  const appliedCouponCode = normalizeSalesCouponCode(proposal.appliedCouponCode);

  if (!appliedCouponCode) {
    return { url: await createSalesProposalCheckout(request, proposal) };
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

  if (!proposal.hubspotDealId && isHubSpotConfigured()) {
    const synced = await saveSalesProposal(proposal, proposal.slug || proposal.id || "proposal");
    proposal = synced;
  }

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
      stripe_checkout_session_id: session.id,
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

  const proposal = mapSalesProposalRow(typedProposalRow);
  const mappedProposalId = proposal.id;
  if (!mappedProposalId) {
    throw new Error("La propuesta pagada no tiene un identificador valido.");
  }
  const subscriptionId = payment.subscriptionId;
  const paymentIntentId = payment.paymentIntentId;
  let activatedClientId = proposal.activatedClientId;

  if (!activatedClientId) {
    if (!proposal.assignedCsmUserId) {
      if (proposal.hubspotDealId) {
        await moveHubSpotDealToWon(proposal.hubspotDealId);
      }

      const { error: paidUpdateError } = await admin
        .from("sales_proposals")
        .update(({
          status: "paid",
          paid_at: new Date().toISOString(),
          stripe_checkout_session_id: payment.checkoutSessionId,
          stripe_payment_intent_id: paymentIntentId,
          stripe_subscription_id: subscriptionId,
          hubspot_deal_stage_id: process.env.HUBSPOT_DEAL_STAGE_WON_ID ?? typedProposalRow.hubspot_deal_stage_id,
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
      credit_validity_days: 60,
      sales_cleared: true,
      updated_by_user_id: proposal.assignedCsmUserId,
    }) as never, {
      onConflict: "client_id",
    });

    if (configError) {
      throw configError;
    }
  }

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
          unit_credits: subitem.unitCredits,
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
        entry: "Iniciativa activada desde la plataforma comercial.",
        created_by_user_id: proposal.assignedCsmUserId,
      }) as never);
    }
  }

  if (proposal.hubspotDealId) {
    await moveHubSpotDealToWon(proposal.hubspotDealId);
  }

  const { error: updateError } = await admin
    .from("sales_proposals")
    .update(({
      status: "board_activated",
      activated_client_id: activatedClientId,
      activated_at: new Date().toISOString(),
      paid_at: new Date().toISOString(),
      stripe_checkout_session_id: payment.checkoutSessionId,
      stripe_payment_intent_id: paymentIntentId,
      stripe_subscription_id: subscriptionId,
      hubspot_deal_stage_id: process.env.HUBSPOT_DEAL_STAGE_WON_ID ?? typedProposalRow.hubspot_deal_stage_id,
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

  if (storedCoupon) {
    await activateSalesProposalFromCoupon(mapSalesProposalRow(typedProposalRow), storedCoupon);
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

  const currentProposal = mapSalesProposalRow(typedProposalRow);
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

  return mapSalesProposalRow(typedRefreshedRow);
}
