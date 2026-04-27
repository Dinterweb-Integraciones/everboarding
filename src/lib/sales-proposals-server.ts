import Stripe from "stripe";

import {
  createHubSpotDeal,
  isHubSpotConfigured,
  moveHubSpotDealToWon,
  updateHubSpotDeal,
} from "@/lib/hubspot";
import {
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
type ClientRow = Database["public"]["Tables"]["clients"]["Row"];
type OnboardingInitiativeRow = Database["public"]["Tables"]["onboarding_initiatives"]["Row"];

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

export async function saveSalesProposal(input: SalesProposalDraft, proposalSlug: string) {
  const admin = createSupabaseAdminClient();
  const serialized = serializeSalesProposalDraft({ ...input, slug: proposalSlug });
  const existing = await admin
    .from("sales_proposals")
    .select("*")
    .eq("slug", proposalSlug)
    .maybeSingle();
  const existingRow = existing.data as SalesProposalRow | null;

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

export async function createSalesProposalCheckout(request: Request, proposal: SalesProposalRecord) {
  if (!proposal.assignedCsmUserId) {
    throw new Error("Asigna un CSM antes de activar el plan.");
  }
  const proposalId = proposal.id;
  if (!proposalId) {
    throw new Error("La propuesta debe guardarse antes de activar el checkout.");
  }

  const admin = createSupabaseAdminClient();
  const stripe = getStripe();
  const origin = resolveOrigin(request);
  const amountInCents = Math.round(proposal.quotedPrice * 100);

  if (!proposal.hubspotDealId && isHubSpotConfigured()) {
    const synced = await saveSalesProposal(proposal, proposal.slug || proposal.id || "proposal");
    proposal = synced;
  }

  const session = await stripe.checkout.sessions.create({
    mode: proposal.billingMode === "one_time" ? "payment" : "subscription",
    submit_type: proposal.billingMode === "one_time" ? "pay" : "subscribe",
    customer_email: proposal.clientEmail || undefined,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: resolveCurrency(proposal.currency),
          unit_amount: amountInCents,
          ...(proposal.billingMode === "subscription"
            ? {
                recurring: {
                  interval: "month",
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
    success_url: `${origin}/sales/proposals/${proposal.slug}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/sales/proposals/${proposal.slug}?payment=cancelled`,
    metadata: {
      sales_proposal_id: proposal.id || "",
      sales_proposal_slug: proposal.slug || "",
      sales_client_name: proposal.clientName,
    },
    ...(proposal.billingMode === "subscription"
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

export async function activateSalesProposalAfterPayment(
  stripe: Stripe,
  proposalId: string,
  session: Stripe.Checkout.Session,
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
  let activatedClientId = proposal.activatedClientId;

  if (!activatedClientId) {
    if (!proposal.assignedCsmUserId) {
      throw new Error("La propuesta pagada no tiene un CSM asignado.");
    }

    const clientSlug = `${slugify(proposal.clientCompany || proposal.clientName || proposal.title)}-${Date.now().toString(36)}`;
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

    if (clientError || !typedInsertedClient) {
      throw clientError ?? new Error("No pudimos crear el cliente para Customer Success.");
    }

    activatedClientId = typedInsertedClient.id;

    const { error: configError } = await admin.from("onboarding_configs").insert(({
      client_id: typedInsertedClient.id,
      start_date: proposal.startDate || toIsoDate(),
      base_capacity: proposal.contractedCredits,
      custom_plan_credits: proposal.contractedCredits,
      custom_plan_price: proposal.quotedPrice,
      custom_plan_type: proposal.billingMode === "one_time" ? "proyecto" : "mensual",
      custom_plan_billing_mode: proposal.billingMode,
      custom_plan_period_months: proposal.periodMonths,
      current_stage: "cs",
      credit_validity_days: 60,
      sales_cleared: true,
      updated_by_user_id: proposal.assignedCsmUserId,
    }) as never);

    if (configError) {
      throw configError;
    }

    for (const [initiativeIndex, initiative] of proposal.initiatives.entries()) {
      const { data: insertedInitiative, error: initiativeError } = await admin
        .from("onboarding_initiatives")
        .insert(({
          client_id: typedInsertedClient.id,
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

  const paymentArgs: RecordStripeCheckoutPaymentArgs = {
    p_client_id: activatedClientId,
    p_checkout_session_id: session.id,
    p_payment_intent_id:
      typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null,
    p_amount_cents: session.amount_total ?? 0,
    p_currency: session.currency ?? "usd",
    p_stripe_subscription_id:
      typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null,
    p_stripe_invoice_id: typeof session.invoice === "string" ? session.invoice : session.invoice?.id ?? null,
  };

  const { error: paymentError } = await admin.rpc(
    "record_stripe_checkout_payment" as never,
    paymentArgs as never,
  );

  if (paymentError) {
    throw paymentError;
  }

  const subscriptionId =
    typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;
  if (subscriptionId) {
    await stripe.subscriptions.update(subscriptionId, {
      metadata: {
        client_id: activatedClientId,
        sales_proposal_id: mappedProposalId,
      },
    });
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
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id:
        typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null,
      stripe_subscription_id: subscriptionId,
      hubspot_deal_stage_id: process.env.HUBSPOT_DEAL_STAGE_WON_ID ?? typedProposalRow.hubspot_deal_stage_id,
      updated_at: new Date().toISOString(),
    }) as never)
    .eq("id", mappedProposalId);

  if (updateError) {
    throw updateError;
  }
}
