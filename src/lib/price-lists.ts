import { DEFAULT_SALES_CURRENCY, normalizeSalesCurrency } from "@/lib/currency";
import { safeParseNumber } from "@/lib/utils";

// Listas de precios por país o región. Cada lista ajusta cuántos créditos cuesta cada caso de uso
// (porcentaje de aumento o de descuento) y define el paquete que se vende con ella: créditos,
// precio base y moneda. El vendedor de Dinterweb elige la lista en la propuesta y el cliente la
// hereda al activarse. Un país puede estar en varias listas. La tabla price_lists y
// clients.price_list_id no están en database.ts (ver límite de complejidad de tipos): se consultan
// con el cliente admin sin tipar.

export type PriceListAdjustmentType = "increase" | "discount";

export type PriceList = {
  id: string;
  name: string;
  description: string | null;
  countries: string[];
  adjustment_type: PriceListAdjustmentType;
  percentage: number;
  package_credits: number;
  package_price: number;
  currency: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

// Paquete que se vende con la lista: el vendedor arranca la propuesta con él (y sus múltiplos) y el
// cliente amplía con él.
export type PriceListPackage = {
  credits: number;
  price: number;
  currency: string;
};

// Paquete de las listas creadas antes de que cada lista definiera el suyo.
export const DEFAULT_PRICE_LIST_PACKAGE: PriceListPackage = {
  credits: 80,
  price: 1197,
  currency: DEFAULT_SALES_CURRENCY,
};

// Lo que se congela en la propuesta: si la lista cambia después, la propuesta conserva el ajuste y
// el paquete con los que se cotizó. Las propuestas cotizadas antes de los paquetes por lista no
// tienen package (null): conservan el paquete con el que se armaron.
export type PriceListAdjustment = {
  id: string;
  name: string;
  adjustmentType: PriceListAdjustmentType;
  percentage: number;
  package: PriceListPackage | null;
};

// Opción que ve el vendedor al elegir la lista.
export type PriceListOption = PriceListAdjustment & {
  countries: string[];
};

export const MAX_PRICE_LIST_PERCENTAGE = 100;

export function normalizePriceListAdjustmentType(value: unknown): PriceListAdjustmentType {
  return value === "discount" ? "discount" : "increase";
}

export function normalizePriceListPercentage(value: unknown, adjustmentType: PriceListAdjustmentType) {
  const parsed = safeParseNumber(value as string | number | null | undefined);
  const upperBound = adjustmentType === "discount" ? 99.99 : MAX_PRICE_LIST_PERCENTAGE;
  return Math.round(Math.min(upperBound, Math.max(0, parsed)) * 100) / 100;
}

export function normalizePriceListCountries(value: unknown) {
  if (!Array.isArray(value)) return [];

  const codes = value
    .map((entry) => String(entry ?? "").trim().toUpperCase())
    .filter((entry) => /^[A-Z]{2}$/.test(entry));

  return Array.from(new Set(codes)).sort();
}

export function normalizePriceListPackageCredits(value: unknown) {
  return Math.max(0, Math.round(safeParseNumber(value as string | number | null | undefined)));
}

export function normalizePriceListPackagePrice(value: unknown) {
  return Math.max(0, Math.round(safeParseNumber(value as string | number | null | undefined) * 100) / 100);
}

// Lee un paquete guardado (snapshot o fila); null si está incompleto.
export function normalizePriceListPackage(value: unknown): PriceListPackage | null {
  if (!value || typeof value !== "object") return null;

  const raw = value as Record<string, unknown>;
  const credits = normalizePriceListPackageCredits(raw.credits);
  const price = normalizePriceListPackagePrice(raw.price);

  if (credits <= 0 || price <= 0) return null;

  return { credits, price, currency: normalizeSalesCurrency(raw.currency) };
}

export function getPriceListPackage(
  priceList: Pick<PriceList, "package_credits" | "package_price" | "currency">,
): PriceListPackage {
  return (
    normalizePriceListPackage({
      credits: priceList.package_credits,
      price: priceList.package_price,
      currency: priceList.currency,
    }) ?? DEFAULT_PRICE_LIST_PACKAGE
  );
}

export function toPriceListAdjustment(
  priceList: Pick<
    PriceList,
    "id" | "name" | "adjustment_type" | "percentage" | "package_credits" | "package_price" | "currency"
  >,
): PriceListAdjustment {
  const adjustmentType = normalizePriceListAdjustmentType(priceList.adjustment_type);

  return {
    id: priceList.id,
    name: priceList.name,
    adjustmentType,
    percentage: normalizePriceListPercentage(priceList.percentage, adjustmentType),
    package: getPriceListPackage(priceList),
  };
}

export function toPriceListOption(priceList: PriceList): PriceListOption {
  return {
    ...toPriceListAdjustment(priceList),
    countries: normalizePriceListCountries(priceList.countries),
  };
}

// Lee el ajuste guardado en el snapshot de la propuesta; descarta valores incompletos.
export function normalizePriceListAdjustment(value: unknown): PriceListAdjustment | null {
  if (!value || typeof value !== "object") return null;

  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const adjustmentType = normalizePriceListAdjustmentType(raw.adjustmentType);
  const percentage = normalizePriceListPercentage(raw.percentage, adjustmentType);

  if (!id) return null;

  return {
    id,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "Lista de precios",
    adjustmentType,
    percentage,
    package: normalizePriceListPackage(raw.package),
  };
}

export function getPriceListFactor(adjustment: PriceListAdjustment | null | undefined) {
  if (!adjustment || adjustment.percentage <= 0) return 1;

  const ratio = adjustment.percentage / 100;
  return adjustment.adjustmentType === "discount" ? 1 - ratio : 1 + ratio;
}

// Créditos que cuesta un caso de uso (o una tarea) con la lista: es su precio en recurrencia. En
// paquete se le suma después el recargo de paquete (ver getClientCatalogCredits en onboarding).
// Un aumento redondea hacia arriba (así también sube un caso pequeño: 3 CR +10% = 4 CR); un descuento
// redondea al entero más cercano. Un caso que cuesta algo nunca baja de 1 crédito.
export function applyPriceListToCredits(
  credits: number,
  adjustment: PriceListAdjustment | null | undefined,
) {
  const base = Math.max(0, safeParseNumber(credits));

  if (!adjustment || base === 0) return base;

  // toFixed evita que errores de punto flotante suban un entero exacto (10 × 1.1 = 11.000…02).
  const adjusted = Number((base * getPriceListFactor(adjustment)).toFixed(6));
  const rounded = adjustment.adjustmentType === "increase" ? Math.ceil(adjusted) : Math.round(adjusted);

  return Math.max(1, rounded);
}

// Ajusta los créditos de las filas del catálogo (tareas o casos de uso) antes de cotizarlas. Todo lo
// que se calcula después (recargo de paquete, valor "con Everboarding") parte de estos créditos.
export function applyPriceListToCatalogCredits<T extends { credits: number | null }>(
  rows: T[],
  adjustment: PriceListAdjustment | null | undefined,
): T[] {
  if (!adjustment) return rows;

  return rows.map(
    (row) =>
      ({
        ...row,
        credits: applyPriceListToCredits(Number(row.credits ?? 0), adjustment),
      }) as T,
  );
}

export function formatPriceListAdjustment(
  adjustment: Pick<PriceListAdjustment, "adjustmentType" | "percentage"> | null | undefined,
) {
  if (!adjustment) return "Créditos base";
  if (adjustment.percentage <= 0) return "Sin ajuste";

  const sign = adjustment.adjustmentType === "discount" ? "-" : "+";
  return `${sign}${adjustment.percentage}%`;
}

export function getPriceListAdjustmentLabel(
  adjustment: Pick<PriceListAdjustment, "adjustmentType" | "percentage">,
) {
  if (adjustment.percentage <= 0) return "";
  return adjustment.adjustmentType === "discount" ? "Descuento" : "Aumento";
}

// Códigos ISO 3166-1 alfa-2. Los nombres se resuelven en español con Intl.DisplayNames.
const COUNTRY_CODES =
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(
    " ",
  );

let countryNameFormatter: Intl.DisplayNames | null | undefined;

export function getCountryName(code: string) {
  if (countryNameFormatter === undefined) {
    try {
      countryNameFormatter = new Intl.DisplayNames(["es"], { type: "region" });
    } catch {
      countryNameFormatter = null;
    }
  }

  try {
    return countryNameFormatter?.of(code) ?? code;
  } catch {
    return code;
  }
}

export function getCountryOptions() {
  return COUNTRY_CODES.map((code) => ({ code, name: getCountryName(code) })).sort((left, right) =>
    left.name.localeCompare(right.name, "es"),
  );
}

export function formatPriceListCountries(codes: string[], maxVisible = 4) {
  if (!codes.length) return "Sin países asignados";

  const names = codes.map((code) => getCountryName(code));
  if (names.length <= maxVisible) return names.join(", ");

  return `${names.slice(0, maxVisible).join(", ")} y ${names.length - maxVisible} más`;
}

// "120 CR · EUR 2.000" para mostrar el paquete de una lista.
export function formatPriceListPackageLabel(pricePackage: PriceListPackage) {
  const currency = pricePackage.currency.toUpperCase();
  let price = `${currency} ${pricePackage.price}`;

  try {
    price = new Intl.NumberFormat("es-NI", { style: "currency", currency, maximumFractionDigits: 0 }).format(
      pricePackage.price,
    );
  } catch {
    // Moneda desconocida para Intl: se muestra el código y el monto.
  }

  return `${pricePackage.credits} CR · ${price}`;
}
