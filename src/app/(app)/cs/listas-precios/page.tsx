import { PriceListsManager } from "@/components/cs/price-lists-manager";
import { requireUser } from "@/lib/auth";
import { listPriceListLinks } from "@/lib/price-list-links-server";
import { listPriceLists } from "@/lib/price-lists-server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PriceListsPage() {
  await requireUser("/cs/listas-precios");

  const priceLists = await listPriceLists().catch((error) => {
    console.error("price_lists_page_load_failed", error);
    throw new Error("No pudimos cargar el catálogo de listas de precios.");
  });

  const priceListLinks = await listPriceListLinks().catch((error) => {
    console.error("price_list_links_page_load_failed", error);
    return [];
  });

  // clients.price_list_id no está en database.ts (ver límite de complejidad de tipos).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createSupabaseAdminClient() as any;
  const { data: clientRows } = (await admin
    .from("clients")
    .select("price_list_id")
    .not("price_list_id", "is", null)) as { data: Array<{ price_list_id: string }> | null };
  const clientCounts = new Map<string, number>();

  (clientRows ?? []).forEach((row) => {
    clientCounts.set(row.price_list_id, (clientCounts.get(row.price_list_id) ?? 0) + 1);
  });

  return (
    <PriceListsManager
      initialPriceLists={priceLists.map((priceList) => ({
        ...priceList,
        client_count: clientCounts.get(priceList.id) ?? 0,
      }))}
      initialLinks={priceListLinks}
    />
  );
}
