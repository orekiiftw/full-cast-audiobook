import { createHash, randomBytes } from "crypto";
import { and, eq, gt, gte, lt } from "drizzle-orm";
import { db } from "./db";
import { sessions, users } from "./schema";
import { firstRow } from "./lib/query";

export const SESSION_COOKIE = "narratea_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const SESSION_MAX_AGE_MS = (() => {
  const configured = Number(process.env.SESSION_MAX_AGE_MS);
  if (!Number.isFinite(configured) || !Number.isInteger(configured) || configured <= 0) return SESSION_TTL_MS;
  return Math.min(configured, SESSION_TTL_MS);
})();

export interface AuthUser {
  id: string;
  email: string;
}

export interface SessionToken {
  token: string;
  expiresAt: Date;
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
    if (name !== SESSION_COOKIE) continue;
    try {
      return decodeURIComponent(value.join("="));
    } catch {
      return null;
    }
  }
  return null;
}

export function sessionCookie(req: Request, token: string, expires: Date): string {
  const secure = cookieSecure(req) ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Expires=${expires.toUTCString()}${secure}`;
}

export function clearSessionCookie(req: Request): string {
  const secure = cookieSecure(req) ? "; Secure" : "";
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

export function parsedClientIp(req: Request, connectionIp: string): string {
  if (process.env.TRUST_PROXY !== "true") return connectionIp;
  const header = req.headers.get("x-forwarded-for");
  if (!header) return connectionIp;

  const hops = header
    .split(",")
    .map((hop) => hop.trim())
    .filter((hop) => hop.length > 0);
  if (hops.length === 0) return connectionIp;

  const configuredHops = Number(process.env.TRUST_PROXY_HOPS);
  const trustedHops = Number.isFinite(configuredHops) && Number.isInteger(configuredHops) && configuredHops > 0 ? configuredHops : 1;
  if (hops.length < trustedHops) return connectionIp;

  return hops[hops.length - trustedHops] || connectionIp;
}

export async function createSession(userId: string): Promise<SessionToken> {
  const session = newSessionToken();
  await db.insert(sessions).values({ userId, tokenHash: hashSessionToken(session.token), expiresAt: session.expiresAt });
  sweepExpiredSessions(0.05);
  return session;
}

export async function createSessionRotating(userId: string): Promise<SessionToken> {
  const session = newSessionToken();
  await db.transaction(async (tx) => {
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    await tx.insert(sessions).values({ userId, tokenHash: hashSessionToken(session.token), expiresAt: session.expiresAt });
  });
  return session;
}

function newSessionToken(): SessionToken {
  return {
    token: randomBytes(32).toString("base64url"),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  };
}

function sweepExpiredSessions(probability: number): void {
  if (Math.random() >= probability) return;
  db.delete(sessions)
    .where(lt(sessions.expiresAt, new Date()))
    .catch((err) => console.warn("Session sweep failed:", err));
}

export async function authenticateRequest(req: Request): Promise<AuthUser | null> {
  const token = readSessionToken(req);
  if (!token) return null;

  const minCreatedAt = new Date(Date.now() - SESSION_MAX_AGE_MS);
  const row = await firstRow(
    db
      .select({ id: users.id, email: users.email })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(
        and(
          eq(sessions.tokenHash, hashSessionToken(token)),
          gt(sessions.expiresAt, new Date()),
          gte(sessions.createdAt, minCreatedAt),
          eq(users.disabled, false),
        ),
      )
      .limit(1),
  );

  return row ?? null;
}

function cookieSecure(req: Request): boolean {
  if (process.env.INSECURE_HTTP === "true") return false;
  if (process.env.NODE_ENV === "production") return true;
  const forwarded = process.env.TRUST_PROXY === "true" ? req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() : undefined;
  return new URL(req.url).protocol === "https:" || forwarded === "https";
}
