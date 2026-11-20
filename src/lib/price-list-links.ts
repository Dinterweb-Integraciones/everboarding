// Enlace de una lista de precios para vendedores externos: abre el cotizador sin iniciar sesión,
// con la tarifa de la lista fija.
export type PriceListLink = {
  id: string;
  price_list_id: string;
  token: string;
  label: string | null;
  is_active: boolean;
  created_at: string;
};

export function getPriceListLinkPath(token: string) {
  return `/cotizar/${token}`;
}

export const PRICE_LIST_LINK_SELLER_COMPANY = "Partner Dinterweb";

// Quien cotiza con el enlace no se identifica: sus propuestas quedan a nombre del enlace.
export function getPriceListLinkSellerName(context: {
  link: Pick<PriceListLink, "label">;
  priceList: { name: string };
}) {
  return context.link.label?.trim() || context.priceList.name.trim() || PRICE_LIST_LINK_SELLER_COMPANY;
}
