import { eq } from "drizzle-orm";
import { db } from "../../db";
import { sessions, users } from "../../schema";
import {
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
import { type PublicRouteContext, type PublicRouteTable } from "../route";
import { firstRow } from "../../lib/query";
import { readJsonWithLimit } from "../body";
import { createRateLimiter } from "../rateLimit";

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

const loginRateLimited = createRateLimiter({ windowMs: LOGIN_WINDOW_MS, maxAttempts: MAX_ATTEMPTS });

let dummyHashPromise: Promise<string> | null = null;

export const authRoutes: PublicRouteTable = {
  "POST /api/auth/signup": signUp,
  "POST /api/auth/login": logIn,
  "POST /api/auth/logout": logOut,
  "GET /api/auth/me": currentUser,
};

async function signUp({ req, connectionIp }: PublicRouteContext): Promise<Response> {
  if (rateLimited(req, connectionIp)) return json({ error: "Too many attempts. Try again later." }, 429);

  const { email, password } = await credentials(req);

  if (process.env.REGISTRATION_ENABLED !== "true") {
    return json({ error: "Account registration is disabled." }, 403);
  }

  if (!isValidEmail(email) || !isValidPassword(password)) {
    return json({ error: "Use a valid email and a password between 12 and 128 characters." }, 400);
  }

  const created = await insertUser(email, password);
  if (!created) {
    return json({ error: "Could not create an account with that email. It may already be registered." }, 409);
  }

  const session = await createSession(created.id);
  return withCookie({ user: created }, sessionCookie(req, session.token, session.expiresAt), 201);
}

async function logIn({ req, connectionIp }: PublicRouteContext): Promise<Response> {
  if (rateLimited(req, connectionIp)) return json({ error: "Too many attempts. Try again later." }, 429);

  const { email, password } = await credentials(req);
  const account = isValidEmail(email) ? await accountByEmail(email) : null;

  if (!account || account.disabled) {
    await verifyAgainstDummy(password);
    return json({ error: "Invalid email or password." }, 401);
  }

  if (!(await Bun.password.verify(password, account.passwordHash, "argon2id"))) {
    return json({ error: "Invalid email or password." }, 401);
  }

  const session = await createSessionRotating(account.id);
  return withCookie({ user: { id: account.id, email: account.email } }, sessionCookie(req, session.token, session.expiresAt));
}

async function logOut({ req }: PublicRouteContext): Promise<Response> {
  const token = readSessionToken(req);
  if (token) {
    await db.delete(sessions).where(eq(sessions.tokenHash, hashSessionToken(token)));
  }
  return withCookie({ success: true }, clearSessionCookie(req));
}

async function currentUser({ user }: PublicRouteContext): Promise<Response> {
  if (!user) return json({ error: "Authentication required" }, 401);
  return json({ user }, 200, { "Cache-Control": "no-store" });
}

async function credentials(req: Request): Promise<{ email: string; password: string }> {
  const body = (await readJsonWithLimit(req)) as Record<string, unknown>;
  return {
    email: normalizeEmail(typeof body.email === "string" ? body.email : ""),
    password: typeof body.password === "string" ? body.password : "",
  };
}

async function insertUser(email: string, password: string) {
  try {
    return await firstRow(
      db
        .insert(users)
        .values({
          email,
          passwordHash: await Bun.password.hash(password, { algorithm: "argon2id" }),
        })
        .returning({ id: users.id, email: users.email }),
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return null;
    throw error;
  }
}

async function accountByEmail(email: string) {
  return firstRow(db.select().from(users).where(eq(users.email, email)).limit(1));
}

function withCookie(data: unknown, cookie: string, status = 200): Response {
  return json(data, status, { "Set-Cookie": cookie, "Cache-Control": "no-store" });
}

function verifyAgainstDummy(password: string): Promise<boolean> {
  dummyHashPromise ??= Bun.password.hash("timing-equalization-dummy", { algorithm: "argon2id" });
  return dummyHashPromise.then((hash) => Bun.password.verify(password, hash, "argon2id")).catch(() => false);
}

function rateLimited(req: Request, connectionIp: string): boolean {
  if (connectionIp === "unknown") return false;
  return loginRateLimited(`${new URL(req.url).pathname}:${connectionIp}`);
}
