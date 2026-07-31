/**
 * CORS is opt-in: the SPA is served same-origin by the Bun server (and the
 * Vite dev proxy keeps it same-origin too), so no cross-origin allowance is
 * emitted by default. Set CORS_ORIGIN (e.g. https://app.example.com) to
 * explicitly allow one external origin. Credentialed CORS is limited to that
 * exact origin; wildcard origins are never supported.
 *
 * When configured, the headers are emitted consistently on every API
 * response. This is safe for a single static origin: browsers still block
 * credentialed access from any other origin, and the CSRF guard rejects
 * cross-site mutations before they reach a handler.
 */
const ALLOWED_ORIGIN = process.env.CORS_ORIGIN?.trim() || null;

function corsHeaders(): Record<string, string> {
  if (!ALLOWED_ORIGIN) return {};
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

export function json<T>(data: T, status = 200, extraHeaders: Record<string, string> = {}, req?: Request): Response {
  void req; // kept for call-site compatibility; CORS headers are origin-agnostic (see above)
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Content-Type-Options": "nosniff",
      // Authenticated API data must never be cached by the browser (a shared
      // or back/forward cache could show a previous user's library).
      "Cache-Control": "no-store",
      ...corsHeaders(),
      ...extraHeaders,
    },
  });
}

export function corsPreflight(req: Request): Response {
  void req;
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

/**
 * Binary (audio/image) response. Converts Buffer -> Uint8Array so the body
 * satisfies the Fetch BodyInit typings.
 */
export function binary(
  buffer: Buffer,
  contentType: string,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
      ...corsHeaders(),
      ...extraHeaders,
    },
  });
}
