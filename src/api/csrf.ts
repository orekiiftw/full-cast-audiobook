import { json } from "./response";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function csrfGuard(req: Request): Response | null {
  if (req.headers.get("sec-fetch-site") === "cross-site") {
    return forbidden("cross-site request blocked");
  }

  if (SAFE_METHODS.has(req.method)) {
    return null;
  }

  const origin = req.headers.get("origin");
  if (!origin) {
    return null;
  }

  switch (classifyOrigin(origin, req.url)) {
    case "allowed":
      return null;
    case "invalid":
      return forbidden("invalid origin");
    default:
      return forbidden("origin not allowed");
  }
}

type OriginVerdict = "allowed" | "denied" | "invalid";

function classifyOrigin(origin: string, requestUrl: string): OriginVerdict {
  try {
    const originUrl = new URL(origin);
    const { origin: requestOrigin, hostname: requestHostname } = new URL(requestUrl);
    const configured = process.env.CORS_ORIGIN;
    const configuredOrigin = configured ? configured.trim() : null;

    const sameRequestOrigin = originUrl.origin === requestOrigin;
    const sameLoopbackMachine = isLoopbackHostname(requestHostname) && isLoopbackHostname(originUrl.hostname);

    return sameRequestOrigin || sameLoopbackMachine || originUrl.origin === configuredOrigin ? "allowed" : "denied";
  } catch {
    return "invalid";
  }
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function forbidden(reason: string): Response {
  return json({ error: `Forbidden: ${reason}` }, 403);
}
