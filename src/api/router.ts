import { json, corsPreflight } from "./response";
import { ValidationError } from "../lib/validators";
import { registerBookRoutes } from "./routes/books";
import { registerChapterRoutes } from "./routes/chapters";
import { registerSegmentRoutes } from "./routes/segments";
import { registerAudioRoutes } from "./routes/audio";
import { registerCastRoutes } from "./routes/cast";
import { registerPlaybackRoutes } from "./routes/playback";
import { registerPronunciationRoutes } from "./routes/pronunciation";
import { registerEventRoutes } from "./routes/events";
import { registerAuthRoutes } from "./routes/auth";
import { registerBookSearchRoutes } from "./routes/bookSearch";
import { authenticateRequest, AuthUser } from "../auth";

type RouteHandler = (req: Request, path: string, user: AuthUser) => Promise<Response | null>;

const handlers: RouteHandler[] = [
  registerBookRoutes,
  registerBookSearchRoutes,
  registerChapterRoutes,
  registerSegmentRoutes,
  registerAudioRoutes,
  registerCastRoutes,
  registerPlaybackRoutes,
  registerPronunciationRoutes,
  registerEventRoutes,
];

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * CSRF defense for the cookie-authenticated API:
 * 1. Browsers tag cross-site requests (including <img> and <form> posts) with
 *    `Sec-Fetch-Site: cross-site` — reject those outright. Same-origin and
 *    same-site (e.g. Vite dev proxy on another localhost port) pass through,
 *    as do non-browser clients (curl), which send no header.
 * 2. For mutating methods, when an Origin header is present it must match the
 *    request host, equal CORS_ORIGIN, or — only when the request itself is
 *    served over loopback — be another loopback-origin (the Vite dev proxy).
 *
 * The loopback-to-loopback allowance used to be unconditional, which let any
 * local `http://127.0.0.1:<port>` page issue credentialed mutations against a
 * logged-in user once the server was bound beyond loopback (e.g. LAN). Now the
 * dev exception applies only when the server is actually reached over a
 * loopback host, so a LAN- or internet-exposed deployment is not reachable
 * from arbitrary local origins. An operator who needs a specific second origin
 * should set CORS_ORIGIN instead.
 */
function csrfGuard(req: Request): Response | null {
  if (req.headers.get("sec-fetch-site") === "cross-site") {
    return json({ error: "Forbidden: cross-site request blocked" }, 403);
  }

  if (!SAFE_METHODS.has(req.method)) {
    const origin = req.headers.get("origin");
    if (origin) {
      try {
        const o = new URL(origin);
        const r = new URL(req.url);
        // The dev-proxy exception only holds when THIS request is loopback-bound.
        const loopbackDevException = isLoopbackHostname(r.hostname) &&
          isLoopbackHostname(o.hostname);
        const allowed =
          o.host === r.host ||
          loopbackDevException ||
          (!!process.env.CORS_ORIGIN && o.origin === process.env.CORS_ORIGIN.trim());
        if (!allowed) {
          return json({ error: "Forbidden: origin not allowed" }, 403);
        }
      } catch {
        return json({ error: "Forbidden: invalid origin" }, 403);
      }
    }
  }

  return null;
}

export async function handleRequest(req: Request, connectionIp = "unknown"): Promise<Response> {
  const path = new URL(req.url).pathname;

  if (req.method === "OPTIONS") {
    return corsPreflight(req);
  }

  const blocked = csrfGuard(req);
  if (blocked) return blocked;

  try {
    const user = await authenticateRequest(req);
    const authResponse = await registerAuthRoutes(req, path, user, connectionIp);
    if (authResponse) return authResponse;

    if (!user) return json({ error: "Authentication required" }, 401);

    for (const handler of handlers) {
      const response = await handler(req, path, user);
      if (response) return response;
    }

    return json({ error: "Endpoint not found" }, 404);
  } catch (error) {
    if (error instanceof ValidationError) {
      return json({ error: error.message }, 400);
    }
    // Malformed request bodies (e.g. req.json() on invalid JSON) are client errors
    if (error instanceof SyntaxError) {
      return json({ error: "Invalid request body" }, 400);
    }
    // Log the real error server-side; never leak internals (DB errors, file
    // paths, storage backend details) to the client.
    console.error(`API error on ${req.method} ${path}:`, error);
    return json({ error: "Internal server error" }, 500);
  }
}
