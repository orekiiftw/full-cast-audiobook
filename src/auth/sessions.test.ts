import { afterEach, describe, expect, it, mock } from "bun:test";
import { createHash } from "crypto";

const BEARER_USER = { id: "00000000-0000-0000-0000-000000000001", email: "bearer@example.com" };
const COOKIE_USER = { id: "00000000-0000-0000-0000-000000000002", email: "cookie@example.com" };
const BEARER_TOKEN = "bearer-token-under-test";
const COOKIE_TOKEN = "cookie-token-under-test";

mock.module("./sessionLookup", () => ({
  findUserByTokenHash: async (tokenHash: string) => {
    if (tokenHash === sha256(BEARER_TOKEN)) return BEARER_USER;
    if (tokenHash === sha256(COOKIE_TOKEN)) return COOKIE_USER;
    return null;
  },
}));

import {
  authenticateRequest,
  clearSessionCookie,
  readBearerSessionToken,
  readCookieSessionToken,
  readSessionToken,
  sessionCookie,
} from "./sessions";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const ENV_KEYS = ["INSECURE_HTTP", "NODE_ENV", "TRUST_PROXY"] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

const EXPIRES = new Date("2030-01-01T00:00:00Z");

describe("session cookie Secure attribute", () => {
  it("is Secure without NODE_ENV=production or a trusted proxy", () => {
    delete process.env.INSECURE_HTTP;
    delete process.env.TRUST_PROXY;
    process.env.NODE_ENV = "development";

    expect(sessionCookie("token", EXPIRES)).toEndWith("; Secure");
    expect(clearSessionCookie()).toEndWith("; Secure");
  });

  it("drops Secure only when INSECURE_HTTP=true", () => {
    process.env.INSECURE_HTTP = "true";
    process.env.NODE_ENV = "production";

    expect(sessionCookie("token", EXPIRES)).not.toContain("Secure");
    expect(clearSessionCookie()).not.toContain("Secure");
  });
});

function request(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/books", { headers });
}

describe("session token readers", () => {
  it("reads only the session cookie from the cookie header", () => {
    expect(readCookieSessionToken(request({ cookie: `theme=dark; narratea_session=${COOKIE_TOKEN}; other=1` }))).toBe(COOKIE_TOKEN);
    expect(readCookieSessionToken(request({ cookie: "theme=dark" }))).toBeNull();
    expect(readCookieSessionToken(request())).toBeNull();
  });

  it("reads a Bearer token case-insensitively and rejects other schemes", () => {
    expect(readBearerSessionToken(request({ authorization: `Bearer ${BEARER_TOKEN}` }))).toBe(BEARER_TOKEN);
    expect(readBearerSessionToken(request({ authorization: `bearer   ${BEARER_TOKEN}` }))).toBe(BEARER_TOKEN);
    expect(readBearerSessionToken(request({ authorization: "Bearer" }))).toBeNull();
    expect(readBearerSessionToken(request({ authorization: "Basic dXNlcjpwYXNz" }))).toBeNull();
    expect(readBearerSessionToken(request({ authorization: "Bearer two words" }))).toBeNull();
    expect(readBearerSessionToken(request())).toBeNull();
  });

  it("prefers the Bearer header over the cookie when both are present", () => {
    expect(readSessionToken(request({ authorization: `Bearer ${BEARER_TOKEN}`, cookie: `narratea_session=${COOKIE_TOKEN}` }))).toBe(
      BEARER_TOKEN,
    );
    expect(readSessionToken(request({ cookie: `narratea_session=${COOKIE_TOKEN}` }))).toBe(COOKIE_TOKEN);
  });
});

describe("authenticateRequest", () => {
  it("authenticates a Bearer token", async () => {
    expect(await authenticateRequest(request({ authorization: `Bearer ${BEARER_TOKEN}` }))).toEqual(BEARER_USER);
  });

  it("still authenticates the session cookie", async () => {
    expect(await authenticateRequest(request({ cookie: `narratea_session=${COOKIE_TOKEN}` }))).toEqual(COOKIE_USER);
  });

  it("resolves a Bearer request to its own user when a cookie rides along", async () => {
    const both = request({ authorization: `Bearer ${BEARER_TOKEN}`, cookie: `narratea_session=${COOKIE_TOKEN}` });
    expect(await authenticateRequest(both)).toEqual(BEARER_USER);
  });

  it("rejects an unknown token without falling back to the cookie", async () => {
    const stale = request({ authorization: "Bearer not-a-session", cookie: `narratea_session=${COOKIE_TOKEN}` });
    expect(await authenticateRequest(stale)).toBeNull();
    expect(await authenticateRequest(request({ cookie: "narratea_session=forged" }))).toBeNull();
  });

  it("returns null when the request carries no token at all", async () => {
    expect(await authenticateRequest(request())).toBeNull();
  });
});
