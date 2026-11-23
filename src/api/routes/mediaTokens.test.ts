import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

const USER = { id: "00000000-0000-0000-0000-000000000080", email: "media@example.com" };
const OWNED_BOOK = "00000000-0000-0000-0000-000000000081";
const FOREIGN_BOOK = "00000000-0000-0000-0000-000000000082";
const SECRET = "media-token-secret-under-test";

mock.module("../../books/ownership", () => ({
  ownsStorageKey: async (_userId: string, key: string) => key.startsWith(`books/${OWNED_BOOK}/`),
  ownerOfStorageKey: async (key: string) => (key.startsWith(`books/${OWNED_BOOK}/`) ? USER.id : null),
}));

import { mediaTokenRoutes } from "./mediaTokens";
import { dispatchRoute } from "../testSupport";
import { errorResponse } from "../errors";
import { mediaSignature, mediaTokenTtlSeconds } from "../../lib/mediaToken";

const ENV_KEYS = ["MEDIA_TOKEN_SECRET", "MEDIA_TOKEN_TTL_SECONDS"] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

beforeEach(() => {
  process.env.MEDIA_TOKEN_SECRET = SECRET;
  delete process.env.MEDIA_TOKEN_TTL_SECONDS;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

const SEGMENT_KEY = `books/${OWNED_BOOK}/chapters/ch_1/segment_1.wav`;
const CHAPTER_KEY = `books/${OWNED_BOOK}/chapters/chapter_1.mp3`;

function request(body: unknown): Request {
  return new Request("http://localhost/api/media-tokens", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost" },
    body: JSON.stringify(body),
  });
}

async function issue(body: unknown): Promise<Response> {
  const req = request(body);
  try {
    return await dispatchRoute(mediaTokenRoutes, req, USER);
  } catch (error) {
    return errorResponse(error, req, "/api/media-tokens");
  }
}

function parse(url: string): { key: string; exp: number; sig: string } {
  const params = new URL(url, "http://localhost").searchParams;
  return { key: params.get("key")!, exp: Number(params.get("exp")), sig: params.get("sig")! };
}

describe("POST /api/media-tokens", () => {
  it("signs every requested key for the calling user", async () => {
    const before = Math.floor(Date.now() / 1000);
    const res = await issue({ keys: [SEGMENT_KEY, CHAPTER_KEY] });
    const body = (await res.json()) as { urls: Record<string, string>; expiresAt: string };

    expect(res.status).toBe(200);
    expect(Object.keys(body.urls).sort()).toEqual([CHAPTER_KEY, SEGMENT_KEY].sort());

    for (const key of [SEGMENT_KEY, CHAPTER_KEY]) {
      const url = body.urls[key];
      expect(url).toStartWith("/api/audio?key=");
      const { key: parsedKey, exp, sig } = parse(url);
      expect(parsedKey).toBe(key);
      expect(exp).toBeGreaterThanOrEqual(before + mediaTokenTtlSeconds() - 1);
      expect(sig).toBe(mediaSignature(key, USER.id, exp));
    }

    const exp = parse(body.urls[SEGMENT_KEY]).exp;
    expect(body.expiresAt).toBe(new Date(exp * 1000).toISOString());
  });

  it("honours MEDIA_TOKEN_TTL_SECONDS", async () => {
    process.env.MEDIA_TOKEN_TTL_SECONDS = "90";
    const res = await issue({ keys: [SEGMENT_KEY] });
    const body = (await res.json()) as { urls: Record<string, string> };

    const exp = parse(body.urls[SEGMENT_KEY]).exp;
    const ttl = exp - Math.floor(Date.now() / 1000);
    expect(ttl).toBeGreaterThan(85);
    expect(ttl).toBeLessThanOrEqual(90);
  });

  it("rejects an empty, oversized, or malformed key list", async () => {
    const empty = await issue({ keys: [] });
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as { error: string }).error).toContain("between 1 and 50");

    expect((await issue({ keys: Array.from({ length: 51 }, (_, index) => `books/${OWNED_BOOK}/ch_${index}.wav`) })).status).toBe(400);
    expect((await issue({ keys: [42] })).status).toBe(400);
    expect((await issue({})).status).toBe(400);
  });

  it("rejects an unsafe storage key", async () => {
    const res = await issue({ keys: [`books/${OWNED_BOOK}/../../etc/passwd`] });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("Invalid file key");
  });

  it("refuses to sign a key the user does not own", async () => {
    const res = await issue({ keys: [SEGMENT_KEY, `books/${FOREIGN_BOOK}/chapters/chapter_1.mp3`] });

    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe("File not found");
  });
});
