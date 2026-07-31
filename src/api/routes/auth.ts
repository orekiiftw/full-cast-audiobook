import { eq } from "drizzle-orm";
import { db } from "../../db";
import { sessions, users } from "../../schema";
import {
  AuthUser,
  clearSessionCookie,
  createSession,
  createSessionRotating,
  hashSessionToken,
  isValidEmail,
  isValidPassword,
  normalizeEmail,
  readSessionToken,
  sessionCookie,
} from "../../auth";
import { json } from "../response";
import { readJsonWithLimit } from "../../lib/validators";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const attempts = new Map<string, { count: number; resetAt: number }>();
let lastSweep = 0;

/** Evict expired rate-limit entries so the map can't grow without bound. */
function sweepAttempts(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, entry] of attempts) {
    if (entry.resetAt <= now) attempts.delete(key);
  }
}

/**
 * Equalizes login response time for unknown vs. known emails: always run one
 * argon2id verification so attackers can't enumerate accounts via timing.
 */
let dummyHashPromise: Promise<string> | null = null;
function verifyAgainstDummy(password: string): Promise<boolean> {
  dummyHashPromise ??= Bun.password.hash("timing-equalization-dummy", { algorithm: "argon2id" });
  return dummyHashPromise
    .then((hash) => Bun.password.verify(password, hash, "argon2id"))
    .catch(() => false);
}

function rateLimited(req: Request, route: string, connectionIp: string): boolean {
  void req;
  const now = Date.now();
  sweepAttempts(now);
  const key = `${route}:${connectionIp}`;
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

function withCookie(req: Request, data: unknown, cookie: string, status = 200): Response {
  return json(data, status, { "Set-Cookie": cookie, "Cache-Control": "no-store" }, req);
}

export async function registerAuthRoutes(req: Request, path: string, user: AuthUser | null, connectionIp: string = "unknown"): Promise<Response | null> {
  if ((path === "/api/auth/signup" || path === "/api/auth/login") && req.method === "POST") {
    if (rateLimited(req, path, connectionIp)) return json({ error: "Too many attempts. Try again later." }, 429, {}, req);
    const body = (await readJsonWithLimit(req)) as Record<string, unknown>;
    const email = normalizeEmail(typeof body.email === "string" ? body.email : "");
    const password = typeof body.password === "string" ? body.password : "";

    if (path === "/api/auth/signup") {
      // Registration is closed by default: set REGISTRATION_ENABLED=true to
      // create your account(s), then unset it (or set "false") to lock the
      // server back down. A server exposed beyond loopback with open signup
      // lets strangers create accounts and burn your TTS/LLM spend.
      if (process.env.REGISTRATION_ENABLED !== "true") {
        return json({ error: "Account registration is disabled." }, 403, {}, req);
      }
      if (!isValidEmail(email) || !isValidPassword(password)) {
        return json({ error: "Use a valid email and a password between 12 and 128 characters." }, 400, {}, req);
      }
      let created;
      try {
        created = await db.insert(users).values({
          email,
          passwordHash: await Bun.password.hash(password, { algorithm: "argon2id" }),
        }).returning({ id: users.id, email: users.email }).then((rows) => rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          return json({ error: "An account with that email already exists. Sign in instead." }, 409, {}, req);
        }
        throw error;
      }
      const session = await createSession(created.id);
      return withCookie(req, { user: created }, sessionCookie(req, session.token, session.expiresAt), 201);
    }

    const account = isValidEmail(email)
      ? await db.select().from(users).where(eq(users.email, email)).limit(1).then((rows) => rows[0])
      : null;
    if (!account || account.disabled) {
      // Burn an equivalent hash verification so the response time doesn't
      // reveal whether the email exists.
      await verifyAgainstDummy(password);
      return json({ error: "Invalid email or password." }, 401);
    }
    if (!(await Bun.password.verify(password, account.passwordHash, "argon2id"))) {
      return json({ error: "Invalid email or password." }, 401);
    }
    // Rotate on every login: revoke all prior sessions for this user so a
    // cookie stolen before this login is invalidated immediately.
    const session = await createSessionRotating(account.id);
    return withCookie(req, { user: { id: account.id, email: account.email } }, sessionCookie(req, session.token, session.expiresAt));
  }

  if (path === "/api/auth/logout" && req.method === "POST") {
    const token = readSessionToken(req);
    if (token) await db.delete(sessions).where(eq(sessions.tokenHash, hashSessionToken(token)));
    return withCookie(req, { success: true }, clearSessionCookie(req));
  }

  if (path === "/api/auth/me" && req.method === "GET") {
    if (!user) return json({ error: "Authentication required" }, 401);
    return json({ user }, 200, { "Cache-Control": "no-store" });
  }

  return null;
}
