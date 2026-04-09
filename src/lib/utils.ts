import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function formatCurrency(value: number, currency = "USD") {
  return new Intl.NumberFormat("es-NI", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatDate(date: string | null | undefined) {
  if (!date) {
    return "--";
  }

  const parsedDate = date.includes("T") ? new Date(date) : new Date(`${date}T00:00:00`);

  return new Intl.DateTimeFormat("es-NI", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsedDate);
}

export function toIsoDate(date = new Date()) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

export function safeParseNumber(value: string | number | null | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatUserError(
  error: unknown,
  fallback = "No pudimos completar la solicitud. Intenta de nuevo.",
) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  const normalized = message.toLowerCase();

  if (!normalized) {
    return fallback;
  }

  if (normalized.includes("invalid login credentials")) {
    return "El correo o la contrasena no son correctos.";
  }

  if (normalized.includes("email not confirmed")) {
    return "Revisa tu correo y confirma tu cuenta antes de continuar.";
  }

  if (normalized.includes("user already registered")) {
    return "Ya existe una cuenta con ese correo.";
  }

  if (
    normalized.includes("failed to fetch") ||
    normalized.includes("network") ||
    normalized.includes("fetch")
  ) {
    return "No pudimos conectarnos en este momento. Verifica tu internet e intenta de nuevo.";
  }

  if (
    normalized.includes("supabase") ||
    normalized.includes("row-level security") ||
    normalized.includes("jwt") ||
    normalized.includes("permission") ||
    normalized.includes("rls")
  ) {
    return fallback;
  }

  return message;
}
