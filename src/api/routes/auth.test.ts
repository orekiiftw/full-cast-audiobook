import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

const NATIVE_USER = { id: "00000000-0000-0000-0000-000000000070", email: "listener@example.com" };
const PASSWORD = "correct horse battery";
const TOKEN = "narratea-session-token-under-test";
const EXPIRES = new Date("2030-01-01T00:00:00Z");
const revoked: string[] = [];

mock.module("../../auth", () => ({
  authenticateAccount: async (email: string, password: string) =>
    email === NATIVE_USER.email && password === PASSWORD ? NATIVE_USER : null,
  clearSessionCookie: () => "narratea_session=; HttpOnly; Max-Age=0",
  createSession: async () => ({ token: TOKEN, expiresAt: EXPIRES }),
  createSessionRotating: async () => ({ token: TOKEN, expiresAt: EXPIRES }),
  insertUser: async (email: string) => ({ id: NATIVE_USER.id, email }),
  isValidEmail: (email: string) => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
  isValidPassword: (password: string) => password.length >= 12 && password.length <= 128,
  normalizeEmail: (email: string) => email.trim().toLowerCase(),
  readSessionToken: readSessionTokenFromRealModule,
  revokeSession: async (token: string) => {
    revoked.push(token);
  },
  sessionCookie: (token: string, expires: Date) => `narratea_session=${token}; HttpOnly; Expires=${expires.toUTCString()}`,
}));

const sessionTokens = await import("../../auth/sessionTokens");

function readSessionTokenFromRealModule(req: Request): string | null {
  return sessionTokens.readSessionToken(req);
}

const { authRoutes } = await import("./auth");
const { dispatchRoute } = await import("../testSupport");

const ENV_KEYS = ["REGISTRATION_ENABLED"] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

beforeEach(() => {
  revoked.length = 0;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost", ...headers },
    body: JSON.stringify(body),
  });
}

async function login(body: unknown): Promise<{ status: number; body: Record<string, unknown>; cookie: string | null }> {
  const res = await dispatchRoute(authRoutes, post("/api/auth/login", body), null);
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, cookie: res.headers.get("set-cookie") };
}

describe("POST /api/auth/login", () => {
  it("returns the session token and its expiry to a native client, keeping the cookie", async () => {
    const { status, body, cookie } = await login({ email: NATIVE_USER.email, password: PASSWORD, client: "native" });

    expect(status).toBe(200);
    expect(body.user).toEqual(NATIVE_USER);
    expect(body.token).toBe(TOKEN);
    expect(body.expiresAt).toBe(EXPIRES.toISOString());
    expect(cookie).toContain(`narratea_session=${TOKEN}`);
  });

  it("leaves the web response unchanged without a client field", async () => {
    const { status, body, cookie } = await login({ email: NATIVE_USER.email, password: PASSWORD });

    expect(status).toBe(200);
    expect(body.user).toEqual(NATIVE_USER);
    expect("token" in body).toBe(false);
    expect("expiresAt" in body).toBe(false);
    expect(cookie).toContain(`narratea_session=${TOKEN}`);
  });

  it("leaves the web response unchanged for any other client value", async () => {
    const { body } = await login({ email: NATIVE_USER.email, password: PASSWORD, client: "web" });

    expect("token" in body).toBe(false);
  });

  it("still rejects bad credentials", async () => {
    const { status } = await login({ email: NATIVE_USER.email, password: "wrong password", client: "native" });
    expect(status).toBe(401);
  });
});

describe("POST /api/auth/signup", () => {
  it("returns the session token and its expiry to a native client", async () => {
    process.env.REGISTRATION_ENABLED = "true";
    const res = await dispatchRoute(
      authRoutes,
      post("/api/auth/signup", { email: "new@example.com", password: PASSWORD, client: "native" }),
      null,
    );
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(201);
    expect(body.token).toBe(TOKEN);
    expect(body.expiresAt).toBe(EXPIRES.toISOString());
    expect(res.headers.get("set-cookie")).toContain(`narratea_session=${TOKEN}`);
  });
});

describe("POST /api/auth/logout", () => {
  it("revokes the session named by a Bearer header", async () => {
    const res = await dispatchRoute(authRoutes, post("/api/auth/logout", {}, { Authorization: `Bearer ${TOKEN}` }), null);

    expect(res.status).toBe(200);
    expect(revoked).toEqual([TOKEN]);
  });

  it("revokes the cookie session as before", async () => {
    const cookie = `theme=dark; narratea_session=${TOKEN}`;
    await dispatchRoute(authRoutes, post("/api/auth/logout", {}, { cookie }), null);

    expect(revoked).toEqual([TOKEN]);
  });

  it("revokes nothing when the request carries no session", async () => {
    await dispatchRoute(authRoutes, post("/api/auth/logout", {}), null);
    expect(revoked).toEqual([]);
  });
});
