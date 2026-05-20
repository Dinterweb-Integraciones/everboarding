import { clsx, type ClassValue } from "clsx";

const SHORT_MONTHS_ES = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];

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

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function isIsoDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function formatDateParts(day: number, monthIndex: number, year: number) {
  return `${pad2(day)} ${SHORT_MONTHS_ES[monthIndex]} ${year}`;
}

export function formatDate(date: string | null | undefined) {
  if (!date) {
    return "--";
  }

  if (isIsoDateOnly(date)) {
    const [year, month, day] = date.split("-").map(Number);
    return formatDateParts(day, month - 1, year);
  }

  const parsedDate = new Date(date);
  if (Number.isNaN(parsedDate.getTime())) {
    return "--";
  }

  const formatter = new Intl.DateTimeFormat("es-NI", {
    timeZone: "America/Managua",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const parts = formatter.formatToParts(parsedDate);
  const day = parts.find((part) => part.type === "day")?.value;
  const month = normalizeMonthLabel(parts.find((part) => part.type === "month")?.value);
  const year = parts.find((part) => part.type === "year")?.value;

  if (!day || !month || !year) {
    return "--";
  }

  return `${day} ${month} ${year}`;
}

function normalizeMonthLabel(value: string | undefined) {
  if (!value) {
    return "";
  }

  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(".", "")
    .toLowerCase();
}

export function formatDateTime(date: string | null | undefined) {
  if (!date) {
    return "--";
  }

  const parsedDate = new Date(date);
  if (Number.isNaN(parsedDate.getTime())) {
    return "--";
  }

  const formatter = new Intl.DateTimeFormat("es-NI", {
    timeZone: "America/Managua",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const parts = formatter.formatToParts(parsedDate);
  const day = parts.find((part) => part.type === "day")?.value;
  const month = normalizeMonthLabel(parts.find((part) => part.type === "month")?.value);
  const year = parts.find((part) => part.type === "year")?.value;
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  const rawDayPeriod = parts.find((part) => part.type === "dayPeriod")?.value ?? "";
  const normalizedDayPeriod = rawDayPeriod.toLowerCase().includes("p") ? "p. m." : "a. m.";

  if (!day || !month || !year || !hour || !minute) {
    return "--";
  }

  return `${day} ${month} ${year}, ${hour}:${minute} ${normalizedDayPeriod}`;
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

export function isMissingSupabaseTable(error: unknown, tableName: string) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  const normalized = message.toLowerCase();
  const normalizedTableName = tableName.toLowerCase();

  return (
    normalized.includes(normalizedTableName) &&
    (
      normalized.includes("schema cache") ||
      normalized.includes("could not find the table") ||
      normalized.includes("does not exist") ||
      normalized.includes("relation")
    )
  );
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
