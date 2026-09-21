import * as path from "path";
import { gzipSync } from "node:zlib";

const DIST_ROOT = path.resolve("./dist");

const SECURITY_HEADERS: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
};

const CSP_HEADER = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data:",
  "media-src 'self' data:",
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

const COMPRESSIBLE_EXTENSIONS = new Set([".html", ".js", ".css", ".svg", ".map", ".json"]);
const GZIP_MIN_BYTES = 1024;
const GZIP_CACHE_MAX = 500;

const gzipCache = new Map<string, { data: ArrayBuffer; size: number; mtimeMs: number }>();

export async function serveStaticFile(req: Request): Promise<Response | null> {
  const url = new URL(req.url);
  const filePath = resolveStaticPath(url.pathname);
  if (!filePath) {
    return new Response("Forbidden", { status: 403 });
  }

  const file = Bun.file(filePath);
  if (await file.exists()) {
    return respondWithFile(req, url, filePath, file);
  }

  if (url.pathname === "/" || path.extname(url.pathname)) {
    return null;
  }

  const indexPath = path.join(DIST_ROOT, "index.html");
  const indexFile = Bun.file(indexPath);
  if (!(await indexFile.exists())) {
    return null;
  }

  return respondWithFile(req, url, indexPath, indexFile);
}

function resolveStaticPath(urlPathname: string): string | null {
  const relative = path.extname(urlPathname) ? urlPathname.replace(/^\//, "") : "index.html";
  const resolved = path.resolve(DIST_ROOT, relative);
  if (resolved !== DIST_ROOT && !resolved.startsWith(DIST_ROOT + path.sep)) {
    return null;
  }
  return resolved;
}

async function respondWithFile(req: Request, url: URL, filePath: string, file: ReturnType<typeof Bun.file>): Promise<Response> {
  const extension = path.extname(filePath).toLowerCase();
  const isHtml = extension === ".html";
  const headers: Record<string, string> = {
    "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
    ...SECURITY_HEADERS,
    ...(isHtml ? { "Content-Security-Policy": CSP_HEADER } : {}),
    ...(isHtml ? hstsHeader(req) : {}),
    "Cache-Control": url.pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
    Vary: "Accept-Encoding",
  };

  const gzipped = acceptsGzip(req) ? await getGzippedVariant(filePath, file) : null;
  if (!gzipped) {
    return new Response(file, { headers });
  }

  return new Response(gzipped, {
    headers: {
      ...headers,
      "Content-Encoding": "gzip",
      "Content-Length": String(gzipped.byteLength),
    },
  });
}

function hstsHeader(req: Request): Record<string, string> {
  const forwardedProto = process.env.TRUST_PROXY === "true" ? req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() : undefined;
  const isHttps = new URL(req.url).protocol === "https:" || forwardedProto === "https";
  return isHttps ? { "Strict-Transport-Security": "max-age=63072000; includeSubDomains" } : {};
}

function acceptsGzip(req: Request): boolean {
  const header = req.headers.get("accept-encoding") ?? "";
  return /(^|[,\s])gzip([;\s,]|$)/.test(header) || header.includes("*");
}

async function getGzippedVariant(filePath: string, file: ReturnType<typeof Bun.file>): Promise<ArrayBuffer | null> {
  const extension = path.extname(filePath).toLowerCase();
  if (!COMPRESSIBLE_EXTENSIONS.has(extension)) return null;

  const size = file.size;
  if (size < GZIP_MIN_BYTES) return null;

  const mtimeMs = file.lastModified;
  const cached = gzipCache.get(filePath);
  if (cached && cached.size === size && cached.mtimeMs === mtimeMs) {
    return cached.data;
  }

  const raw = Buffer.from(await file.arrayBuffer());
  const compressed = gzipSync(raw);
  const data = compressed.buffer.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength) as ArrayBuffer;

  if (gzipCache.size >= GZIP_CACHE_MAX) gzipCache.clear();
  gzipCache.set(filePath, { data, size, mtimeMs });
  return data;
}
