// Origen de la app para armar URLs de retorno (checkout de Stripe, enlaces). Nunca se confía en el
// encabezado Origin fuera de desarrollo: lo controla quien hace la petición y permitiría que Stripe
// redirija al cliente a un dominio ajeno al terminar el pago.

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parseOrigin(value: string | null | undefined) {
  if (!value) return null;

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export function resolveAppOrigin(request: Request) {
  // En desarrollo local se respeta el origen exacto (localhost:3000, 127.0.0.1:3001, ...).
  if (process.env.NODE_ENV !== "production") {
    const requestOrigin = parseOrigin(request.headers.get("origin")) ?? parseOrigin(request.url);
    if (requestOrigin && LOCAL_HOSTNAMES.has(requestOrigin.hostname)) {
      return requestOrigin.origin;
    }
  }

  const configuredOrigin = parseOrigin(process.env.NEXT_PUBLIC_SITE_URL);
  if (configuredOrigin) return configuredOrigin.origin;

  // Sin URL configurada: el host al que llegó la petición (lo resuelve la plataforma, no el navegador).
  return new URL(request.url).origin;
}
