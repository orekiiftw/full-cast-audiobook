const ALLOWED_ORIGIN = process.env.CORS_ORIGIN?.trim() || null;

const API_SECURITY_HEADERS: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
};

const CONTENT_SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  ...API_SECURITY_HEADERS,
};

export function corsHeaders(): Record<string, string> {
  if (!ALLOWED_ORIGIN) return {};
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

export function corsPreflight(): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export function json<T>(data: T, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CONTENT_SECURITY_HEADERS,
      "Cache-Control": "no-store",
      ...corsHeaders(),
      ...extraHeaders,
    },
  });
}

export function binary(buffer: Buffer, contentType: string, extraHeaders: Record<string, string> = {}): Response {
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": contentType,
      ...CONTENT_SECURITY_HEADERS,
      ...corsHeaders(),
      ...extraHeaders,
    },
  });
}
