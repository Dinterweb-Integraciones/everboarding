"use client";

import { useMemo } from "react";

import { SalesProposalWorkspace } from "@/components/sales/sales-proposal-workspace";
import { PRICE_LIST_LINK_SELLER_COMPANY } from "@/lib/price-list-links";
import type { PriceListAdjustment } from "@/lib/price-lists";

type WorkspaceProps = React.ComponentProps<typeof SalesProposalWorkspace>;

type ExternalQuoteWorkspaceProps = Pick<
  WorkspaceProps,
  | "initialCatalog"
  | "initialGroups"
  | "initialGroupCategories"
  | "initialGroupCategoryLinks"
  | "initialGroupMemberships"
> & {
  token: string;
  // Nombre con el que quedan las propuestas del enlace (su etiqueta o la lista de precios).
  sellerName: string;
  priceList: PriceListAdjustment;
};

// Cotizador del enlace de una lista de precios: carga el board directo, sin pedir datos al vendedor.
export function ExternalQuoteWorkspace({ token, sellerName, priceList, ...catalogProps }: ExternalQuoteWorkspaceProps) {
  const externalLink = useMemo(() => ({ token, priceList }), [priceList, token]);
  const sellerPreset = useMemo(
    () => ({ name: sellerName, email: "", company: PRICE_LIST_LINK_SELLER_COMPANY }),
    [sellerName],
  );

  return (
    <SalesProposalWorkspace
      {...catalogProps}
      initialProposal={null}
      variant="dinterweb"
      routeBase={`/cotizar/${token}`}
      sellerPreset={sellerPreset}
      externalLink={externalLink}
    />
  );
}
