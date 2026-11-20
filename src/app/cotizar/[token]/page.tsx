import type { Metadata } from "next";

import { ExternalQuoteWorkspace } from "@/components/sales/external-quote-workspace";
import { loadPriceListLinkCatalog } from "@/lib/price-list-link-proposals-server";
import { getPriceListLinkSellerName } from "@/lib/price-list-links";
import { resolveActivePriceListLink } from "@/lib/price-list-links-server";
import { toPriceListAdjustment } from "@/lib/price-lists";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Cotizador Dinterweb",
  robots: { index: false, follow: false },
};

type ExternalQuotePageProps = {
  params: Promise<{ token: string }>;
};

// Cotizador para vendedores externos: se entra con el enlace de una lista de precios, sin sesión, y
// se cotiza con la tarifa de esa lista fija. Solo muestra los casos de uso públicos del catálogo
// y sus tareas.
export default async function ExternalQuotePage({ params }: ExternalQuotePageProps) {
  const { token } = await params;
  const linkContext = await resolveActivePriceListLink(token);

  if (!linkContext) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f5f8fa] px-6">
        <div className="max-w-md rounded-[18px] border border-slate-200 bg-white px-8 py-10 text-center shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">Enlace no disponible</p>
          <h1 className="mt-3 text-2xl font-black text-slate-900">Este enlace ya no está activo</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Pide a tu contacto en Dinterweb un enlace nuevo para crear propuestas.
          </p>
        </div>
      </main>
    );
  }

  const catalog = await loadPriceListLinkCatalog();

  return (
    <ExternalQuoteWorkspace
      token={linkContext.link.token}
      sellerName={getPriceListLinkSellerName(linkContext)}
      priceList={toPriceListAdjustment(linkContext.priceList)}
      initialCatalog={catalog.catalog}
      initialGroups={catalog.groups}
      initialGroupCategories={catalog.groupCategories}
      initialGroupCategoryLinks={catalog.groupCategoryLinks}
      initialGroupMemberships={catalog.memberships}
    />
  );
}
