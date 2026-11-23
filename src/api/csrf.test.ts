import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { csrfGuard } from "./csrf";

const ENV_KEYS = ["TRUST_PROXY", "CORS_ORIGIN"] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

beforeEach(() => {
  delete process.env.CORS_ORIGIN;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function proxiedPost(origin: string, forwardedProto?: string): Request {
  const headers: Record<string, string> = { Origin: origin, "Content-Type": "application/json" };
  if (forwardedProto) headers["X-Forwarded-Proto"] = forwardedProto;
  return new Request("http://narratea.example/api/books", { method: "POST", headers, body: "{}" });
}

describe("csrfGuard behind a TLS-terminating proxy", () => {
  it("accepts a same-origin https POST when the trusted proxy reports https", () => {
    process.env.TRUST_PROXY = "true";
    expect(csrfGuard(proxiedPost("https://narratea.example", "https"))).toBeNull();
    expect(csrfGuard(proxiedPost("https://narratea.example", "HTTPS, http"))).toBeNull();
  });

  it("ignores X-Forwarded-Proto unless TRUST_PROXY=true", () => {
    delete process.env.TRUST_PROXY;
    expect(csrfGuard(proxiedPost("https://narratea.example", "https"))?.status).toBe(403);
    expect(csrfGuard(proxiedPost("http://narratea.example", "https"))).toBeNull();
  });

  it("still rejects an origin whose scheme or host differs from the public request", () => {
    process.env.TRUST_PROXY = "true";
    expect(csrfGuard(proxiedPost("http://narratea.example", "https"))?.status).toBe(403);
    expect(csrfGuard(proxiedPost("https://narratea.example", "http"))?.status).toBe(403);
    expect(csrfGuard(proxiedPost("https://evil.example", "https"))?.status).toBe(403);
  });

  it("falls back to the connection scheme when the forwarded value is not http or https", () => {
    process.env.TRUST_PROXY = "true";
    expect(csrfGuard(proxiedPost("http://narratea.example", "gopher"))).toBeNull();
    expect(csrfGuard(proxiedPost("https://narratea.example", "gopher"))?.status).toBe(403);
  });
});

function post(headers: Record<string, string>): Request {
  return new Request("http://narratea.example/api/books", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: "{}",
  });
}

describe("csrfGuard with a Bearer header", () => {
  it("skips the guard entirely, including the cross-site rejection", () => {
    expect(
      csrfGuard(post({ Authorization: "Bearer native-token", "Sec-Fetch-Site": "cross-site", Origin: "https://evil.example" })),
    ).toBeNull();
  });

  it("skips the origin check for a non-browser Bearer request with no Origin", () => {
    expect(csrfGuard(post({ Authorization: "Bearer native-token" }))).toBeNull();
  });

  it("keeps rejecting cross-site cookie requests", () => {
    const req = new Request("http://narratea.example/api/books", {
      headers: { cookie: "narratea_session=abc", "Sec-Fetch-Site": "cross-site" },
    });
    expect(csrfGuard(req)?.status).toBe(403);
  });

  it("keeps rejecting a foreign Origin on cookie requests", () => {
    expect(csrfGuard(post({ cookie: "narratea_session=abc", Origin: "https://evil.example" }))?.status).toBe(403);
  });

  it("does not let a non-Bearer Authorization header bypass the guard", () => {
    expect(csrfGuard(post({ Authorization: "Basic dXNlcjpwYXNz", Origin: "https://evil.example" }))?.status).toBe(403);
  });
});
