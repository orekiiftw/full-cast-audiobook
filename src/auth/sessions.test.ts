import { afterEach, describe, expect, it } from "bun:test";
import { clearSessionCookie, sessionCookie } from "./sessions";

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
