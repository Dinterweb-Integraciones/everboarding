// Monedas en las que se puede vender un paquete (listas de precios). Todas las cobra Stripe; la
// cuenta debe tenerlas habilitadas para que el checkout funcione.
export const SALES_CURRENCY_OPTIONS = [
  { code: "usd", label: "USD · Dólar estadounidense" },
  { code: "eur", label: "EUR · Euro" },
  { code: "cop", label: "COP · Peso colombiano" },
  { code: "mxn", label: "MXN · Peso mexicano" },
  { code: "gtq", label: "GTQ · Quetzal" },
  { code: "hnl", label: "HNL · Lempira" },
  { code: "nio", label: "NIO · Córdoba" },
  { code: "crc", label: "CRC · Colón costarricense" },
  { code: "dop", label: "DOP · Peso dominicano" },
  { code: "pen", label: "PEN · Sol peruano" },
  { code: "clp", label: "CLP · Peso chileno" },
  { code: "ars", label: "ARS · Peso argentino" },
  { code: "brl", label: "BRL · Real brasileño" },
] as const;

export const DEFAULT_SALES_CURRENCY = "usd";

const SALES_CURRENCY_CODES = new Set<string>(SALES_CURRENCY_OPTIONS.map((option) => option.code));

export function isSupportedSalesCurrency(value: unknown): value is string {
  return typeof value === "string" && SALES_CURRENCY_CODES.has(value.trim().toLowerCase());
}

export function normalizeSalesCurrency(value: unknown, fallback = DEFAULT_SALES_CURRENCY) {
  const code = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-z]{3}$/.test(code) ? code : fallback;
}

// Monedas sin decimales en Stripe: el monto se envía en unidades, no en centavos.
// https://docs.stripe.com/currencies#zero-decimal
const STRIPE_ZERO_DECIMAL_CURRENCIES = new Set([
  "bif",
  "clp",
  "djf",
  "gnf",
  "jpy",
  "kmf",
  "krw",
  "mga",
  "pyg",
  "rwf",
  "ugx",
  "vnd",
  "vuv",
  "xaf",
  "xof",
  "xpf",
]);

// Monto que espera Stripe en unit_amount para la moneda dada.
export function toStripeUnitAmount(amount: number, currency: string) {
  const code = normalizeSalesCurrency(currency);
  return STRIPE_ZERO_DECIMAL_CURRENCIES.has(code) ? Math.round(amount) : Math.round(amount * 100);
}
