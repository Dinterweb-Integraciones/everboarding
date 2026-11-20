import { NextResponse } from "next/server";

import {
  getClientCatalogCredits,
  normalizeCatalogText,
  type CreditCatalogGroup,
  type CreditCatalogGroupCategory,
  type CreditCatalogGroupCategoryLink,
  type CreditCatalogGroupItem,
  type CreditCatalogItem,
} from "@/lib/onboarding";
import { getPriceListLinkSellerName, PRICE_LIST_LINK_SELLER_COMPANY } from "@/lib/price-list-links";
import {
  applyPriceListToCredits,
  getPriceListPackage,
  toPriceListAdjustment,
  type PriceList,
  type PriceListAdjustment,
} from "@/lib/price-lists";
import {
  getPriceListLinkProposalCount,
  getSalesProposalPriceListLinkId,
  resolveActivePriceListLink,
} from "@/lib/price-list-links-server";
import { getSalesProposalBySlug } from "@/lib/sales-proposal-access";
import {
  getDefaultSalesCreditValidityDays,
  normalizeSalesProposalDraft,
  type SalesProposalDraft,
  type SalesProposalInitiativeDraft,
  type SalesProposalRecord,
} from "@/lib/sales-proposals";
import { enforceRateLimits, getRequestIp, type RateLimitRule } from "@/lib/rate-limit-server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Propuestas de vendedores externos que entran con el enlace de una lista de precios. No tienen
// sesión: el token del enlace es su credencial. Por eso el servidor no confía en nada de lo que
// manda el navegador: fija la tarifa del enlace, recalcula créditos, inversión y casos de uso desde
// el catálogo público, no permite cupones, bonificaciones, pagos ni activaciones manuales, y solo
// deja guardar las propuestas creadas con ese enlace mientras siguen en borrador.

export type PriceListLinkContext = NonNullable<Awaited<ReturnType<typeof resolveActivePriceListLink>>>;

// Topes para que un enlace no se use para inflar propuestas ni saturar el servidor.
const MAX_LINK_PACKAGES = 50;
const MAX_LINK_INITIATIVES = 60;
const MAX_LINK_SUBITEMS_PER_INITIATIVE = 60;
const MAX_LINK_SUBITEM_QUANTITY = 50;
const MAX_LINK_PROPOSALS = 500;

const LINK_RATE_LIMITS = {
  create: { limit: 30, windowSeconds: 60 * 60 },
  update: { limit: 600, windowSeconds: 60 * 60 },
  activate: { limit: 20, windowSeconds: 60 * 60 },
} satisfies Record<string, RateLimitRule>;

export type PriceListLinkAction = keyof typeof LINK_RATE_LIMITS;

export function priceListLinkErrorResponse(message: string, status = 400) {
  return NextResponse.json({ message }, { status });
}

export async function requireActivePriceListLink(token: string) {
  const context = await resolveActivePriceListLink(token);

  return context
    ? { ok: true as const, context }
    : {
        ok: false as const,
        response: priceListLinkErrorResponse(
          "Este enlace ya no está disponible. Pide uno nuevo a Dinterweb.",
          404,
        ),
      };
}

// Límite de peticiones por enlace y por IP para cada acción del cotizador externo.
export async function enforcePriceListLinkRateLimit(
  request: Request,
  context: PriceListLinkContext,
  action: PriceListLinkAction,
) {
  const rule = LINK_RATE_LIMITS[action];

  return enforceRateLimits([
    { bucket: `price-link:${context.link.id}:${action}`, rule },
    { bucket: `price-link-ip:${getRequestIp(request)}:${action}`, rule },
  ]);
}

// Tope de propuestas por enlace: corta la creación masiva aunque se reparta en el tiempo.
export async function requirePriceListLinkProposalCapacity(context: PriceListLinkContext) {
  const count = await getPriceListLinkProposalCount(context.link.id);

  return count >= MAX_LINK_PROPOSALS
    ? priceListLinkErrorResponse(
        "Este enlace alcanzó el máximo de propuestas. Pide uno nuevo a Dinterweb.",
        429,
      )
    : null;
}

// Propuesta del enlace: existe, se creó con este enlace y sigue en borrador.
export async function requirePriceListLinkProposal(context: PriceListLinkContext, slug: string) {
  const stored = await getSalesProposalBySlug(slug);
  const linkId = stored ? await getSalesProposalPriceListLinkId(slug) : null;

  if (!stored || linkId !== context.link.id) {
    return {
      ok: false as const,
      response: priceListLinkErrorResponse("No encontramos la propuesta en este enlace.", 404),
    };
  }

  if (stored.proposal.status !== "draft") {
    return {
      ok: false as const,
      response: priceListLinkErrorResponse("La propuesta ya fue enviada a pago y no se puede editar.", 400),
    };
  }

  return { ok: true as const, proposal: stored.proposal };
}

export type PriceListLinkCatalog = {
  catalog: CreditCatalogItem[];
  groups: CreditCatalogGroup[];
  groupCategories: CreditCatalogGroupCategory[];
  groupCategoryLinks: CreditCatalogGroupCategoryLink[];
  memberships: CreditCatalogGroupItem[];
};

// Catálogo que ve el vendedor externo: solo los casos de uso públicos y activos, y solo las tareas
// activas que pertenecen a ellos. Se usa para pintar el cotizador y para validar lo que guarda.
export async function loadPriceListLinkCatalog(): Promise<PriceListLinkCatalog> {
  const admin = createSupabaseAdminClient();
  const [catalogResult, groupsResult, groupCategoriesResult, groupCategoryLinksResult, membershipsResult] =
    await Promise.all([
      admin.from("credit_catalog_items").select("*").eq("is_active", true).order("category").order("sort_order"),
      admin
        .from("credit_catalog_groups")
        .select("*")
        .eq("is_active", true)
        .eq("is_public", true)
        .order("sort_order")
        .order("name"),
      admin.from("credit_catalog_group_categories").select("*").order("sort_order").order("name"),
      admin
        .from("credit_catalog_group_category_links")
        .select("*")
        .order("category_id")
        .order("sort_order")
        .order("created_at"),
      admin.from("credit_catalog_group_items").select("*").order("sort_order").order("created_at"),
    ]);

  const failed = [catalogResult, groupsResult, groupCategoriesResult, groupCategoryLinksResult, membershipsResult].find(
    (result) => result.error,
  );
  if (failed?.error) {
    console.error("price_list_link_catalog_load_failed", failed.error);
    throw new Error("No pudimos cargar el catálogo en este momento.");
  }

  const groups = (groupsResult.data ?? []) as CreditCatalogGroup[];
  const publicGroupIds = new Set(groups.map((group) => group.id));
  const activeItems = (catalogResult.data ?? []) as CreditCatalogItem[];
  const activeItemIds = new Set(activeItems.map((item) => item.id));
  const memberships = ((membershipsResult.data ?? []) as CreditCatalogGroupItem[]).filter(
    (membership) => publicGroupIds.has(membership.group_id) && activeItemIds.has(membership.catalog_item_id),
  );
  const publicItemIds = new Set(memberships.map((membership) => membership.catalog_item_id));

  return {
    catalog: activeItems.filter((item) => publicItemIds.has(item.id)),
    groups,
    groupCategories: (groupCategoriesResult.data ?? []) as CreditCatalogGroupCategory[],
    groupCategoryLinks: ((groupCategoryLinksResult.data ?? []) as CreditCatalogGroupCategoryLink[]).filter((link) =>
      publicGroupIds.has(link.group_id),
    ),
    memberships,
  };
}

function resolveLinkPriceList(priceList: PriceList, existing: SalesProposalRecord | null) {
  // Una propuesta ya guardada conserva la tarifa congelada con la que se cotizó.
  return existing?.priceList?.id === priceList.id ? existing.priceList : toPriceListAdjustment(priceList);
}

function clampInteger(value: unknown, min: number, max: number) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : min;
}

// Rehace los casos de uso con los créditos del catálogo público y la tarifa del enlace. Se descartan
// las tareas que no son del catálogo público (incluidas las manuales) y las bonificaciones.
function sanitizeLinkInitiatives(
  initiatives: SalesProposalInitiativeDraft[],
  catalog: PriceListLinkCatalog,
  priceList: PriceListAdjustment | null,
): SalesProposalInitiativeDraft[] {
  // Los enlaces solo venden paquetes: las tareas llevan el recargo de paquete.
  const priceCredits = (rawCredits: number) =>
    getClientCatalogCredits(applyPriceListToCredits(rawCredits, priceList), true);
  const itemsById = new Map(catalog.catalog.map((item) => [item.id, item]));
  const groupsWithItems = new Set(catalog.memberships.map((membership) => membership.group_id));
  const itemlessGroupsByTitle = new Map(
    catalog.groups
      .filter((group) => !groupsWithItems.has(group.id))
      .map((group) => [normalizeCatalogText(group.name), group]),
  );

  return initiatives.slice(0, MAX_LINK_INITIATIVES).map((initiative) => {
    const itemlessGroup =
      initiative.subitems.length === 1 && !initiative.subitems[0].catalogItemId
        ? itemlessGroupsByTitle.get(normalizeCatalogText(initiative.title))
        : undefined;

    const subitems = initiative.subitems.slice(0, MAX_LINK_SUBITEMS_PER_INITIATIVE).flatMap((subitem) => {
      const quantity = clampInteger(subitem.quantity, 1, MAX_LINK_SUBITEM_QUANTITY);

      if (subitem.catalogItemId) {
        const item = itemsById.get(subitem.catalogItemId);
        return item
          ? [{ ...subitem, name: item.label, unitCredits: priceCredits(Number(item.credits ?? 0)), quantity }]
          : [];
      }

      // Caso de uso sin tareas: una sola subtarea con el precio del grupo.
      if (itemlessGroup) {
        return [
          {
            ...subitem,
            name: itemlessGroup.name,
            unitCredits: priceCredits(Math.max(1, Number(itemlessGroup.credits ?? 0))),
            quantity,
          },
        ];
      }

      return [];
    });

    return { ...initiative, commerciallyWaived: false, subitems };
  });
}

// Limpia lo que envía el navegador del vendedor externo antes de guardarlo.
export async function sanitizePriceListLinkDraft(
  input: unknown,
  context: PriceListLinkContext,
  existing: SalesProposalRecord | null,
): Promise<{ ok: true; draft: SalesProposalDraft } | { ok: false; message: string }> {
  const body = normalizeSalesProposalDraft((input ?? {}) as Record<string, unknown>);
  const priceList = resolveLinkPriceList(context.priceList, existing);
  const pricePackage = priceList?.package ?? getPriceListPackage(context.priceList);
  const catalog = await loadPriceListLinkCatalog();

  // El vendedor externo no se identifica: la propuesta queda a nombre del enlace (su etiqueta o, si no
  // tiene, la lista). Una propuesta ya guardada conserva el vendedor con el que se creó.
  const sellerName = existing?.sellerName.trim() || getPriceListLinkSellerName(context);
  const sellerEmail = existing?.sellerEmail.trim().toLowerCase() ?? "";

  // Créditos e inversión salen del paquete de la lista: se vende un número entero de paquetes y la
  // inversión es exactamente la de esos paquetes (no se pueden subir créditos sin subir el precio).
  const packageCount =
    pricePackage.credits > 0
      ? clampInteger(Math.ceil(Number(body.contractedCredits) / pricePackage.credits), 1, MAX_LINK_PACKAGES)
      : 1;
  const contractedCredits = pricePackage.credits * packageCount;
  const quotedPrice = Math.round(pricePackage.price * packageCount * 100) / 100;

  const draft: SalesProposalDraft = {
    ...body,
    workspaceVariant: "dinterweb",
    priceList,
    currency: pricePackage.currency,
    contractedCredits,
    quotedPrice,
    // Los enlaces externos solo venden paquetes: sin recurrencia, frecuencia ni caudal.
    billingMode: "one_time",
    periodMonths: 1,
    flowCredits: null,
    derivedFlowCredits: false,
    creditValidityDays: existing?.creditValidityDays ?? getDefaultSalesCreditValidityDays("one_time"),
    prospectExtraPackageQuantity: existing?.prospectExtraPackageQuantity ?? 0,
    initiatives: sanitizeLinkInitiatives(body.initiatives, catalog, priceList),
    sellerName: sellerName.slice(0, 120),
    sellerEmail,
    sellerCompany: existing?.sellerCompany.trim().slice(0, 120) || PRICE_LIST_LINK_SELLER_COMPANY,
    status: existing?.status ?? "draft",
    paymentMethod: existing?.paymentMethod ?? "stripe",
    hubspotDealId: existing?.hubspotDealId ?? null,
    activatedClientId: existing?.activatedClientId ?? null,
    assignedCsmUserId: existing?.assignedCsmUserId ?? "",
    appliedCouponId: null,
    appliedCouponCode: "",
    appliedCouponType: null,
    appliedCouponPercentageOff: null,
    couponBaseContractedCredits: null,
    couponBaseQuotedPrice: null,
    couponAppliedAt: null,
    transferBank: existing?.transferBank ?? "",
    transferReference: existing?.transferReference ?? "",
    transferValidatedAt: existing?.transferValidatedAt ?? null,
    transferValidatedByUserId: existing?.transferValidatedByUserId ?? null,
  };

  return { ok: true, draft };
}
