import { isSupportedSalesCurrency } from "@/lib/currency";
import {
  normalizePriceListAdjustmentType,
  normalizePriceListCountries,
  normalizePriceListPackageCredits,
  normalizePriceListPackagePrice,
  normalizePriceListPercentage,
} from "@/lib/price-lists";

export type PriceListInput = {
  name: string;
  description: string | null;
  countries: string[];
  adjustment_type: "increase" | "discount";
  percentage: number;
  package_credits: number;
  package_price: number;
  currency: string;
  is_active: boolean;
};

// Valida el cuerpo que envía el catálogo de listas de precios.
export function parsePriceListInput(body: unknown):
  | { ok: true; value: PriceListInput }
  | { ok: false; message: string } {
  const raw = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const name = String(raw.name ?? "").trim();
  const adjustmentType = normalizePriceListAdjustmentType(raw.adjustmentType);
  const rawPercentage = Number(raw.percentage);
  const countries = normalizePriceListCountries(raw.countries);

  if (!name) {
    return { ok: false, message: "El nombre de la lista es requerido." };
  }

  // 0% = la lista no ajusta los créditos de los casos de uso; solo define paquete y moneda.
  if (!Number.isFinite(rawPercentage) || rawPercentage < 0) {
    return { ok: false, message: "El porcentaje no puede ser negativo." };
  }

  if (adjustmentType === "discount" && rawPercentage >= 100) {
    return { ok: false, message: "El descuento debe ser menor a 100%." };
  }

  if (adjustmentType === "increase" && rawPercentage > 100) {
    return { ok: false, message: "El aumento no puede superar el 100%." };
  }

  if (!countries.length) {
    return { ok: false, message: "Asigna al menos un país a la lista." };
  }

  const packageCredits = normalizePriceListPackageCredits(raw.packageCredits);
  const packagePrice = normalizePriceListPackagePrice(raw.packagePrice);
  const currency = String(raw.currency ?? "").trim().toLowerCase();

  if (packageCredits <= 0) {
    return { ok: false, message: "Define los créditos del paquete (mayor a 0)." };
  }

  if (packagePrice <= 0) {
    return { ok: false, message: "Define el precio base del paquete (mayor a 0)." };
  }

  if (!isSupportedSalesCurrency(currency)) {
    return { ok: false, message: "Elige una moneda válida para el paquete." };
  }

  const description = String(raw.description ?? "").trim();

  return {
    ok: true,
    value: {
      name,
      description: description || null,
      countries,
      adjustment_type: adjustmentType,
      percentage: normalizePriceListPercentage(rawPercentage, adjustmentType),
      package_credits: packageCredits,
      package_price: packagePrice,
      currency,
      is_active: raw.isActive !== false,
    },
  };
}

export function isDuplicatePriceListNameError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}
