import * as path from "path";
import { gzipSync } from "node:zlib";
import { handleRequest } from "./api/router";
import { startPipeline, stopPipeline } from "./orchestrator";
import { parsedClientIp } from "./auth";

// 1. Verify LLM/TTS environment variables and log warnings if missing
function verifyEnvironment() {
  const apiKey = process.env.GEMINI_API_KEY;
  const textModel = process.env.GEMINI_TEXT_MODEL;
  const mimoApiKey = process.env.MIMO_API_KEY;
  const ttsModel = process.env.MIMO_TS_MODEL;

  console.log("🛠️ Starting System Checks...");

  if (!apiKey) {
    console.error(
      "❌ CRITICAL WARNING: GEMINI_API_KEY environment variable is not set! Beat annotation will fail."
    );
  } else {
    console.log("✅ Gemini API Key is configured (annotation).");
  }

  if (!textModel) {
    console.warn(`⚠️ GEMINI_TEXT_MODEL is not set. Defaulting to model fallback.`);
  } else {
    console.log(`✅ Text Model configured: ${textModel}`);
  }

  if (!mimoApiKey) {
    console.error(
      "❌ CRITICAL WARNING: MIMO_API_KEY environment variable is not set! TTS synthesis will fail."
    );
  } else {
    console.log("✅ MiMo API Key is configured (TTS).");
  }

  if (!ttsModel) {
    console.warn(`⚠️ MIMO_TS_MODEL is not set. Defaulting to model fallback.`);
  } else {
    console.log(`✅ TTS Model configured: ${ttsModel}`);
  }

  if (!process.env.TORBOX_API_KEY) {
    console.warn("⚠️ TORBOX_API_KEY is not set. Torrent download service will be unavailable.");
  }

  if (!process.env.DATABASE_URL) {
    console.warn("⚠️ DATABASE_URL is not set. Using local postgres default.");
  }

  if (!process.env.REDIS_URL) {
    console.warn("⚠️ REDIS_URL is not set. Using redis://127.0.0.1:6379 (the pipeline queue requires Redis).");
  }

  if (process.env.INSECURE_HTTP === "true") {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "⚠️ INSECURE_HTTP=true: session cookies will NOT carry the Secure flag. " +
          "Only use this on trusted plain-HTTP networks (e.g. LAN); never on the public internet."
      );
    }
  } else if (process.env.NODE_ENV === "production") {
    console.log("🔒 Session cookies are Secure-only (HTTPS required). Set INSECURE_HTTP=true for plain-HTTP deployments.");
  }
}

verifyEnvironment();

const DIST_ROOT = path.resolve("./dist");

/**
 * Applied to every static response. CSP is added only for HTML documents —
 * the SPA loads scripts/styles from itself, fonts from Google Fonts, and
 * audio/data: URLs for the player and favicon.
 */
const SECURITY_HEADERS: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // The app uses no camera, microphone, geolocation, or other powerful APIs;
  // lock them all down. playback uses <audio>, which is unaffected here.
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
};

/**
 * HTTP Strict-Transport-Security is only emitted on HTTPS responses: sending
 * HSTS over plain HTTP would pin a browser to a host that can't serve TLS,
 * bricking the deployment (the browser refuses the plaintext connection on
 * every subsequent visit). The production cookie path already infers HTTPS
 * via x-forwarded-proto / req.protocol; reuse the same test here.
 */
function hstsHeader(req: Request): Record<string, string> {
  const url = new URL(req.url);
  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const isHttps = url.protocol === "https:" || forwardedProto === "https";
  return isHttps ? { "Strict-Transport-Security": "max-age=63072000; includeSubDomains" } : {};
}

const CSP_HEADER = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

/**
 * Resolve a static file under ./dist, blocking path traversal.
 */
function resolveStaticPath(urlPathname: string): string | null {
  // SPA fallback for non-file routes
  let relative = urlPathname === "/" ? "index.html" : urlPathname.replace(/^\//, "");

  // If no extension, serve SPA shell
  if (!path.extname(relative)) {
    relative = "index.html";
  }

  const resolved = path.resolve(DIST_ROOT, relative);
  if (!resolved.startsWith(DIST_ROOT + path.sep) && resolved !== DIST_ROOT) {
    return null;
  }
  return resolved;
}

/**
 * On-the-fly gzip for text assets. Bun.serve does not compress responses
 * itself, and the Vite JS bundle is by far the largest transfer of the app —
 * gzip cuts it ~75%. Variants are cached keyed by (size, mtime): files under
 * /assets/ are content-hashed and immutable, and index.html changes only on
 * redeploy (mtime busts the stale entry). Bounded so a long-lived process
 * can't grow the cache forever.
 */
const COMPRESSIBLE_EXTS = new Set([".html", ".js", ".css", ".svg", ".map", ".json"]);
const GZIP_MIN_BYTES = 1024; // below this, gzip framing costs more than it saves
const GZIP_CACHE_MAX = 500;
const gzipCache = new Map<string, { data: ArrayBuffer; size: number; mtimeMs: number }>();

function acceptsGzip(req: Request): boolean {
  // Exact-token match on the common cases; "*"" wildcard also accepted.
  const header = req.headers.get("accept-encoding") ?? "";
  return /(^|[,\s])gzip([;\s,]|$)/.test(header) || header.includes("*");
}

async function getGzippedVariant(filePath: string, file: ReturnType<typeof Bun.file>): Promise<ArrayBuffer | null> {
  const ext = path.extname(filePath).toLowerCase();
  if (!COMPRESSIBLE_EXTS.has(ext)) return null;
  const size = file.size;
  if (size < GZIP_MIN_BYTES) return null;
  const mtimeMs = file.lastModified;
  const cached = gzipCache.get(filePath);
  if (cached && cached.size === size && cached.mtimeMs === mtimeMs) {
    return cached.data;
  }
  const raw = Buffer.from(await file.arrayBuffer());
  // Slice out of the Buffer pool into a standalone ArrayBuffer (Buffer.buffer
  // may alias a larger pooled allocation; Response's BodyInit wants ArrayBuffer).
  const buf = gzipSync(raw);
  const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  if (gzipCache.size >= GZIP_CACHE_MAX) gzipCache.clear();
  gzipCache.set(filePath, { data, size, mtimeMs });
  return data;
}

// 2. Start the durable pipeline (Redis queues, boot recovery, workers, sweep)
// BEFORE accepting requests so enqueue paths are ready. Fails fast with an
// actionable error when Redis is unreachable.
await startPipeline();

// 3. Launch Bun.serve
// Bind to loopback by default: although the API is gated behind an
// authenticated session cookie, listening on all interfaces still exposes
// the sign-up/login endpoints. Set HOST=0.0.0.0 only if you know what
// you're doing.
const host = process.env.HOST || "127.0.0.1";

const server = Bun.serve({
  port: Number(process.env.PORT) || 3000,
  hostname: host,
  // Generous socket idle cap instead of fully disabled (slow-loris surface).
  // SSE streams stay up because the server sends a heartbeat every 15s.
  idleTimeout: 120,
  // Annotated return type stops the `server` self-reference from producing
  // an implicit-any cycle during inference.
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // Route /api requests to routes handler
    if (url.pathname.startsWith("/api")) {
      // Real peer address for rate limiting / logging. X-Forwarded-For is parsed
      // via the shared helper so trust hop-counting is consistent everywhere
      // (and the first, client-spoofable hop is never trusted blindly — see
      // parsedClientIp). Without TRUST_PROXY only the raw socket address is used.
      const sock = (server as { requestIP?: (r: Request) => { address: string; family: string; port: number } | null }).requestIP?.(req);
      const connectionIp = parsedClientIp(req, sock?.address ?? "unknown");
      return handleRequest(req, connectionIp);
    }

    // Serve static files from Vite's production build folder "dist"
    try {
      const filePath = resolveStaticPath(url.pathname);
      if (!filePath) {
        return new Response("Forbidden", { status: 403 });
      }

      const file = Bun.file(filePath);
      if (await file.exists()) {
        const ext = path.extname(filePath).toLowerCase();
        // Vite emits content-hashed files under /assets/ — cache them forever.
        // index.html and anything else revalidates so deploys show up at once.
        const isHashedAsset = url.pathname.startsWith("/assets/");
        const isHtml = ext === ".html";
        const headers: Record<string, string> = {
          "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
          "X-Content-Type-Options": "nosniff",
          ...SECURITY_HEADERS,
          ...(isHtml ? { "Content-Security-Policy": CSP_HEADER } : {}),
          ...(isHtml ? hstsHeader(req) : {}),
          "Cache-Control": isHashedAsset
            ? "public, max-age=31536000, immutable"
            : "no-cache",
          Vary: "Accept-Encoding",
        };
        if (acceptsGzip(req)) {
          const gzipped = await getGzippedVariant(filePath, file);
          if (gzipped) {
            return new Response(gzipped, {
              headers: {
                ...headers,
                "Content-Encoding": "gzip",
                "Content-Length": String(gzipped.byteLength),
              },
            });
          }
        }
        return new Response(file, { headers });
      }

      // SPA fallback if asset missing but index exists
      if (url.pathname !== "/" && !path.extname(url.pathname)) {
        const indexPath = path.join(DIST_ROOT, "index.html");
        const indexFile = Bun.file(indexPath);
        if (await indexFile.exists()) {
          const headers: Record<string, string> = {
            "Content-Type": "text/html",
            "X-Content-Type-Options": "nosniff",
            ...SECURITY_HEADERS,
            "Content-Security-Policy": CSP_HEADER,
            ...hstsHeader(req),
            Vary: "Accept-Encoding",
          };
          if (acceptsGzip(req)) {
            const gzipped = await getGzippedVariant(indexPath, indexFile);
            if (gzipped) {
              return new Response(gzipped, {
                headers: {
                  ...headers,
                  "Content-Encoding": "gzip",
                  "Content-Length": String(gzipped.byteLength),
                },
              });
            }
          }
          return new Response(indexFile, { headers });
        }
      }
    } catch (e) {
      console.error("Static serve error:", e);
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`🚀 AI Audiobook performance server running at http://${host}:${server.port}`);

// Graceful shutdown: stop workers from fetching new jobs and let active jobs
// finish so they don't re-enter via stalled recovery. Force-exit if active
// TTS/stitch work outlasts the grace window.
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received — shutting down pipeline workers...`);
  const forceExit = setTimeout(() => {
    console.error("Shutdown grace period expired; force-exiting (active jobs will resume via stalled recovery).");
    process.exit(1);
  }, 30_000);
  try {
    server.stop();
    await stopPipeline();
  } catch (err) {
    console.error("Error during shutdown:", err);
  } finally {
    clearTimeout(forceExit);
    process.exit(0);
  }
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
