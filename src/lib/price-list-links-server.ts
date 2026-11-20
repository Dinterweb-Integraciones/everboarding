import { randomBytes } from "node:crypto";

import type { PriceListLink } from "@/lib/price-list-links";
import { getPriceListById } from "@/lib/price-lists-server";
import type { PriceList } from "@/lib/price-lists";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isMissingSupabaseTable } from "@/lib/utils";

// Enlaces de una lista de precios para vendedores externos (ver migración price_list_links).
// price_list_links y sales_proposals.price_list_link_id no están en database.ts (ver límite de
// complejidad de tipos): se consultan con el cliente admin sin tipar.

function getUntypedAdmin() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createSupabaseAdminClient() as any;
}

function mapPriceListLinkRow(row: Record<string, unknown>): PriceListLink {
  return {
    id: String(row.id),
    price_list_id: String(row.price_list_id),
    token: String(row.token),
    label: typeof row.label === "string" && row.label.trim() ? row.label.trim() : null,
    is_active: row.is_active !== false,
    created_at: String(row.created_at ?? new Date().toISOString()),
  };
}

// Token largo y no adivinable: es la única credencial del vendedor externo.
function generatePriceListLinkToken() {
  return randomBytes(24).toString("base64url");
}

export async function listPriceListLinks(): Promise<PriceListLink[]> {
  const { data, error } = (await getUntypedAdmin()
    .from("price_list_links")
    .select("*")
    .order("created_at", { ascending: true })) as {
    data: Record<string, unknown>[] | null;
    error: Error | null;
  };

  if (error) {
    if (isMissingSupabaseTable(error, "price_list_links")) return [];
    throw error;
  }

  return (data ?? []).map(mapPriceListLinkRow);
}

export async function createPriceListLink(priceListId: string, label: string | null) {
  const { data, error } = (await getUntypedAdmin()
    .from("price_list_links")
    .insert({ price_list_id: priceListId, token: generatePriceListLinkToken(), label })
    .select("*")
    .single()) as { data: Record<string, unknown> | null; error: Error | null };

  if (error || !data) throw error ?? new Error("No pudimos crear el enlace.");

  return mapPriceListLinkRow(data);
}

export async function updatePriceListLink(
  linkId: string,
  patch: { is_active?: boolean; label?: string | null },
) {
  const { data, error } = (await getUntypedAdmin()
    .from("price_list_links")
    .update(patch)
    .eq("id", linkId)
    .select("*")
    .single()) as { data: Record<string, unknown> | null; error: Error | null };

  if (error || !data) throw error ?? new Error("No encontramos el enlace.");

  return mapPriceListLinkRow(data);
}

export async function deletePriceListLink(linkId: string) {
  const { error } = (await getUntypedAdmin().from("price_list_links").delete().eq("id", linkId)) as {
    error: Error | null;
  };

  if (error) throw error;
}

// Enlace vigente: el enlace y su lista deben estar activos. Si no, el vendedor externo pierde acceso.
export async function resolveActivePriceListLink(
  token: string,
): Promise<{ link: PriceListLink; priceList: PriceList } | null> {
  const normalizedToken = token.trim();
  if (!normalizedToken || normalizedToken.length > 128) return null;

  const { data, error } = (await getUntypedAdmin()
    .from("price_list_links")
    .select("*")
    .eq("token", normalizedToken)
    .maybeSingle()) as { data: Record<string, unknown> | null; error: Error | null };

  if (error) {
    if (isMissingSupabaseTable(error, "price_list_links")) return null;
    throw error;
  }

  if (!data) return null;

  const link = mapPriceListLinkRow(data);
  if (!link.is_active) return null;

  const priceList = await getPriceListById(link.price_list_id);
  if (!priceList || !priceList.is_active) return null;

  return { link, priceList };
}

// Enlace con el que se creó la propuesta (null si la creó un vendedor interno).
export async function getSalesProposalPriceListLinkId(slug: string): Promise<string | null> {
  const { data, error } = (await getUntypedAdmin()
    .from("sales_proposals")
    .select("price_list_link_id")
    .eq("slug", slug)
    .maybeSingle()) as { data: { price_list_link_id: string | null } | null; error: Error | null };

  if (error) throw error;

  return data?.price_list_link_id ?? null;
}

export async function setSalesProposalPriceListLinkId(slug: string, linkId: string) {
  const { error } = (await getUntypedAdmin()
    .from("sales_proposals")
    .update({ price_list_link_id: linkId })
    .eq("slug", slug)) as { error: Error | null };

  if (error) throw error;
}

// Propuestas creadas con un enlace (para el tope de propuestas por enlace).
export async function getPriceListLinkProposalCount(linkId: string): Promise<number> {
  const { count, error } = (await getUntypedAdmin()
    .from("sales_proposals")
    .select("id", { count: "exact", head: true })
    .eq("price_list_link_id", linkId)) as { count: number | null; error: Error | null };

  if (error) throw error;

  return count ?? 0;
}
