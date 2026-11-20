import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Límite de peticiones para endpoints sin sesión (ver migración rate_limit_events). La función
// consume_rate_limit no está en database.ts: se llama con el cliente admin sin tipar.

export type RateLimitRule = { limit: number; windowSeconds: number };

// Si la función aún no existe (migración pendiente) o la base falla, se deja pasar y se registra:
// el límite es una protección extra, no debe tumbar el cotizador.
export async function consumeRateLimit(bucket: string, rule: RateLimitRule) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createSupabaseAdminClient() as any;
    const { data, error } = (await admin.rpc("consume_rate_limit", {
      p_bucket: bucket.slice(0, 200),
      p_limit: rule.limit,
      p_window_seconds: rule.windowSeconds,
    })) as { data: boolean | null; error: Error | null };

    if (error) throw error;

    return data !== false;
  } catch (error) {
    console.error("rate_limit_check_failed", { bucket, error });
    return true;
  }
}

// IP del cliente según el proxy de la plataforma (primer valor de x-forwarded-for).
export function getRequestIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedFor || request.headers.get("x-real-ip")?.trim() || "unknown";
}

// Aplica varias reglas (p. ej. por enlace y por IP); devuelve la respuesta 429 si alguna se agotó.
export async function enforceRateLimits(entries: Array<{ bucket: string; rule: RateLimitRule }>) {
  for (const entry of entries) {
    if (!(await consumeRateLimit(entry.bucket, entry.rule))) {
      return NextResponse.json(
        { message: "Hiciste demasiadas solicitudes seguidas. Espera unos minutos e inténtalo de nuevo." },
        { status: 429 },
      );
    }
  }

  return null;
}
