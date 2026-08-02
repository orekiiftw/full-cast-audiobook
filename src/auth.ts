import { createHash, randomBytes } from "crypto";
import { and, eq, gt, gte, lt } from "drizzle-orm";
import { db } from "./db";
import { sessions, users } from "./schema";

export const SESSION_COOKIE = "narratea_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Absolute cap on a session's lifetime regardless of activity, bounded above
 * by the 30-day rolling TTL. Operators who want a shorter window (e.g. 8h or
 * 1d) set SESSION_MAX_AGE_MS; a value at or above SESSION_TTL_MS (the
 * default) leaves the existing behavior unchanged. Enforced in
 * authenticateRequest against sessions.createdAt so a long-lived stolen cookie
 * stops being honored once the absolute cap elapses.
 */
const SESSION_MAX_AGE_MS = (() => {
  const raw = Number(process.env.SESSION_MAX_AGE_MS);
  const fallback = SESSION_TTL_MS;
  if (!Number.isFinite(raw) || !Number.isInteger(raw) || raw <= 0) return fallback;
  return Math.min(raw, SESSION_TTL_MS);
})();

export interface AuthUser {
  id: string;
  email: string;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidPassword(password: string): boolean {
  return password.length >= 12 && password.length <= 128;
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function readSessionToken(req: Request): string | null {
  const cookie = req.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE) {
      // A malformed percent-escape must not blow up request handling
      try {
        return decodeURIComponent(value.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function cookieSecure(req: Request): boolean {
  // Explicit opt-out for plain-HTTP deployments (e.g. LAN appliance without
  // TLS). Without this, NODE_ENV=production emits Secure cookies that the
  // browser silently refuses to store over HTTP — login appears broken.
  if (process.env.INSECURE_HTTP === "true") return false;
  if (process.env.NODE_ENV === "production") return true;
  // Only trust X-Forwarded-Proto when proxy trust is explicitly enabled —
  // a directly-exposed server must not let a client spoof HTTPS-ness.
  const forwarded = process.env.TRUST_PROXY === "true"
    ? req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim()
    : undefined;
  return new URL(req.url).protocol === "https:" || forwarded === "https";
}

export function sessionCookie(req: Request, token: string, expires: Date): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Expires=${expires.toUTCString()}${cookieSecure(req) ? "; Secure" : ""}`;
}

export function clearSessionCookie(req: Request): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${cookieSecure(req) ? "; Secure" : ""}`;
}

/**
 * Parses X-Forwarded-For trusting only the configured number of hops from the
 * RIGHT (closest to the real client). With one fronting proxy, the proxy
 * appends the real client IP as the last entry, so the last hop is the client.
 * Naively trusting the FIRST entry lets an attacker spoof a rotating
 * X-Forwarded-For and bypass the login rate limit / timing defense.
 *
 * The fronting proxy MUST overwrite (or strip) any client-supplied
 * X-Forwarded-For for this to be trustworthy.
 */
export function parsedClientIp(req: Request, connectionIp: string): string {
  if (process.env.TRUST_PROXY !== "true") return connectionIp;
  const header = req.headers.get("x-forwarded-for");
  if (!header) return connectionIp;
  const hops = header
    .split(",")
    .map((h) => h.trim())
    .filter((h) => h.length > 0);
  if (hops.length === 0) return connectionIp;
  // TRUST_PROXY_HOPS = number of trusted proxies in front of this server
  // (default 1). The real client is `hops.length - trustHops` from the left.
  const trustHops = Number(process.env.TRUST_PROXY_HOPS);
  const n = Number.isFinite(trustHops) && Number.isInteger(trustHops) && trustHops > 0 ? trustHops : 1;
  // A chain shorter than the number of trusted proxies means the client could
  // have written every hop present — trusting ANY of them (including the old
  // hops[0] fallback) lets a client spoof the IP the login throttle keys on.
  // Distrust the header entirely and use the direct connection IP.
  if (hops.length < n) return connectionIp;
  return hops[hops.length - n] || connectionIp;
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({ userId, tokenHash: hashSessionToken(token), expiresAt });
  // Opportunistically purge expired sessions (~1 in 20 logins) so the table
  // doesn't grow unboundedly. Best-effort; a failure must not break login.
  if (Math.random() < 0.05) {
    db.delete(sessions)
      .where(lt(sessions.expiresAt, new Date()))
      .catch((err) => console.warn("Session sweep failed:", err));
  }
  return { token, expiresAt };
}

/**
 * Issues a fresh session AND revokes all of the user's prior sessions.
 * Used on login so a cookie stolen before this login stops working
 * immediately (token rotation) rather than surviving the full 30-day TTL.
 * Best-effort revocation: a failure to delete old sessions must not block login.
 */
export async function createSessionRotating(userId: string): Promise<{ token: string; expiresAt: Date }> {
  // Revoke existing sessions and issue the new one atomically in a single
  // transaction: a failed delete must roll back the insert (never leave a
  // stolen cookie valid), and concurrent logins serialize on the row locks
  // instead of both deleting then both inserting.
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.transaction(async (tx) => {
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    await tx.insert(sessions).values({ userId, tokenHash: hashSessionToken(token), expiresAt });
  });
  return { token, expiresAt };
}

export async function authenticateRequest(req: Request): Promise<AuthUser | null> {
  const token = readSessionToken(req);
  if (!token) return null;
  // sessions.createdAt is bounded by the absolute session cap: even a cookie
  // whose rolling expiresAt is still in the future is rejected once it is
  // older than SESSION_MAX_AGE_MS. gte(createdAt, now - maxAge) keeps only
  // sessions created within the absolute window.
  const minCreatedAt = new Date(Date.now() - SESSION_MAX_AGE_MS);
  const row = await db
    .select({ id: users.id, email: users.email })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(
      eq(sessions.tokenHash, hashSessionToken(token)),
      gt(sessions.expiresAt, new Date()),
      gte(sessions.createdAt, minCreatedAt),
      eq(users.disabled, false),
    ))
    .limit(1)
    .then((rows) => rows[0]);
  return row ?? null;
}
