import { normalizeSalesCurrency } from "@/lib/currency";
import {
  DEFAULT_PRICE_LIST_PACKAGE,
  getPriceListPackage,
  normalizePriceListAdjustmentType,
  normalizePriceListCountries,
  normalizePriceListPackageCredits,
  normalizePriceListPackagePrice,
  normalizePriceListPercentage,
  toPriceListAdjustment,
  toPriceListOption,
  type PriceList,
  type PriceListAdjustment,
  type PriceListOption,
  type PriceListPackage,
} from "@/lib/price-lists";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isMissingSupabaseTable } from "@/lib/utils";

// price_lists y clients.price_list_id no están en database.ts (ver límite de complejidad de tipos).
function getUntypedAdmin() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createSupabaseAdminClient() as any;
}

export function mapPriceListRow(row: Record<string, unknown>): PriceList {
  const adjustmentType = normalizePriceListAdjustmentType(row.adjustment_type);

  return {
    id: String(row.id),
    name: String(row.name ?? "").trim(),
    description: typeof row.description === "string" && row.description.trim() ? row.description : null,
    countries: normalizePriceListCountries(row.countries),
    adjustment_type: adjustmentType,
    percentage: normalizePriceListPercentage(row.percentage, adjustmentType),
    // Sin la migración de paquetes, las listas quedan con el paquete por defecto.
    package_credits:
      normalizePriceListPackageCredits(row.package_credits) || DEFAULT_PRICE_LIST_PACKAGE.credits,
    package_price: normalizePriceListPackagePrice(row.package_price) || DEFAULT_PRICE_LIST_PACKAGE.price,
    currency: normalizeSalesCurrency(row.currency, DEFAULT_PRICE_LIST_PACKAGE.currency),
    is_active: row.is_active !== false,
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: String(row.updated_at ?? new Date().toISOString()),
  };
}

export async function listPriceLists(options: { activeOnly?: boolean } = {}): Promise<PriceList[]> {
  const admin = getUntypedAdmin();
  let query = admin.from("price_lists").select("*").order("name", { ascending: true });

  if (options.activeOnly) {
    query = query.eq("is_active", true);
  }

  const { data, error } = (await query) as {
    data: Record<string, unknown>[] | null;
    error: Error | null;
  };

  if (error) {
    // Sin la migración aplicada las vistas siguen funcionando con los créditos base.
    if (isMissingSupabaseTable(error, "price_lists")) return [];
    throw error;
  }

  return (data ?? []).map(mapPriceListRow);
}

// Listas que el vendedor puede elegir en una propuesta.
export async function listSelectablePriceListOptions(): Promise<PriceListOption[]> {
  try {
    return (await listPriceLists({ activeOnly: true })).map(toPriceListOption);
  } catch (error) {
    console.error("price_lists_load_failed", error);
    return [];
  }
}

export async function getPriceListById(priceListId: string): Promise<PriceList | null> {
  const admin = getUntypedAdmin();
  const { data, error } = (await admin
    .from("price_lists")
    .select("*")
    .eq("id", priceListId)
    .maybeSingle()) as { data: Record<string, unknown> | null; error: Error | null };

  if (error) {
    if (isMissingSupabaseTable(error, "price_lists")) return null;
    throw error;
  }

  return data ? mapPriceListRow(data) : null;
}

// Ajuste vigente del cliente: la lista que heredó de su propuesta (o la que le asignó CS). Si la
// lista se edita después, el cliente toma el porcentaje nuevo en los casos que agregue desde entonces.
export async function getClientPriceListAdjustment(
  clientId: string,
): Promise<PriceListAdjustment | null> {
  const priceList = await getClientPriceList(clientId);
  return priceList ? toPriceListAdjustment(priceList) : null;
}

// Paquete con el que amplía el cliente según su lista (créditos, precio y moneda), o null si no
// tiene lista: entonces aplican los paquetes por defecto en USD.
export async function getClientPriceListPackage(clientId: string): Promise<PriceListPackage | null> {
  const priceList = await getClientPriceList(clientId);
  return priceList ? getPriceListPackage(priceList) : null;
}

// Moneda en la que se le cobra al cliente: la de su lista o, sin lista, la moneda por defecto de Stripe.
export async function getClientBillingCurrency(clientId: string) {
  return resolveClientBillingCurrency(await getClientPriceListPackage(clientId));
}

export function resolveClientBillingCurrency(pricePackage: PriceListPackage | null) {
  return pricePackage?.currency ?? normalizeSalesCurrency(process.env.STRIPE_CURRENCY);
}

async function getClientPriceList(clientId: string): Promise<PriceList | null> {
  try {
    const admin = getUntypedAdmin();
    const { data, error } = (await admin
      .from("clients")
      .select("price_list_id")
      .eq("id", clientId)
      .maybeSingle()) as { data: { price_list_id: string | null } | null; error: Error | null };

    if (error) throw error;
    if (!data?.price_list_id) return null;

    return await getPriceListById(data.price_list_id);
  } catch (error) {
    // Una falla al leer la lista no debe bloquear la vista: se usan los créditos base del catálogo.
    console.error("client_price_list_load_failed", { clientId, error });
    return null;
  }
}

export async function assignClientPriceList(clientId: string, priceListId: string | null) {
  const admin = getUntypedAdmin();
  const { error } = (await admin
    .from("clients")
    .update({ price_list_id: priceListId })
    .eq("id", clientId)) as { error: Error | null };

  if (error) throw error;
}

// Lista de precios que se guarda en una propuesta interna. El navegador solo elige la lista: sus
// valores (porcentaje, paquete, moneda) salen de la base, nunca de lo que manda el vendedor. Una
// propuesta que ya tenía esa lista conserva la tarifa congelada con la que se cotizó.
export async function resolveTrustedProposalPriceList(
  requested: PriceListAdjustment | null,
  existing: PriceListAdjustment | null | undefined,
): Promise<PriceListAdjustment | null> {
  if (!requested) return null;
  if (existing && existing.id === requested.id) return existing;

  const priceList = await getPriceListById(requested.id);
  if (!priceList || !priceList.is_active) {
    throw new Error("La lista de precios elegida ya no está disponible. Elige otra o quítala.");
  }

  return toPriceListAdjustment(priceList);
}
