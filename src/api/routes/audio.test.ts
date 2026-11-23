import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

const USER = { id: "00000000-0000-0000-0000-000000000090", email: "stream@example.com" };
const OTHER_USER_ID = "00000000-0000-0000-0000-000000000091";
const BOOK_ID = "00000000-0000-0000-0000-000000000092";
const SECRET = "media-token-secret-under-test";

mock.module("../../storage/r2", () => ({
  statFile: async () => ({ size: 4 }),
  resolveRange: (rangeHeader: string | null, size: number) => (rangeHeader ? { start: 0, end: 1, size } : null),
  streamFile: async () => ({
    stream: new Response("abcd").body,
    length: 4,
    totalSize: 4,
    partial: false,
  }),
}));

const OWNED_KEY = `books/${BOOK_ID}/chapters/ch_1/segment_1.wav`;
const FOREIGN_KEY = "books/00000000-0000-0000-0000-000000000099/chapters/ch_1/segment_1.wav";

mock.module("../../books/ownership", () => ({
  ownsStorageKey: async (_userId: string, key: string) => key === OWNED_KEY,
  ownerOfStorageKey: async (key: string) => (key === OWNED_KEY ? USER.id : null),
}));

import { audioRoutes } from "./audio";
import { dispatchRoute } from "../testSupport";
import { signedAudioUrl } from "../../lib/mediaToken";
import { type AuthUser } from "../../auth";

const ENV_KEYS = ["MEDIA_TOKEN_SECRET"] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

beforeEach(() => {
  process.env.MEDIA_TOKEN_SECRET = SECRET;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function audioReq(url: string): Request {
  return new Request(`http://localhost${url}`);
}

async function stream(url: string, user: AuthUser | null): Promise<Response> {
  return dispatchRoute(audioRoutes, audioReq(url), user);
}

function expSeconds(offsetSeconds: number): number {
  return Math.floor(Date.now() / 1000) + offsetSeconds;
}

describe("GET /api/audio with a media signature", () => {
  it("serves a key whose unexpired signature matches its owner", async () => {
    const res = await stream(signedAudioUrl(OWNED_KEY, USER.id, expSeconds(600)), null);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    expect(await res.text()).toBe("abcd");
  });

  it("does not need a session when the signature is valid", async () => {
    const res = await stream(signedAudioUrl(OWNED_KEY, USER.id, expSeconds(60)), null);
    expect(res.status).toBe(200);
  });

  it("rejects an expired signature", async () => {
    const res = await stream(signedAudioUrl(OWNED_KEY, USER.id, expSeconds(-1)), USER);

    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toContain("Forbidden");
  });

  it("rejects a forged signature, even with a valid session", async () => {
    const url = signedAudioUrl(OWNED_KEY, USER.id, expSeconds(600)).replace(/sig=[0-9a-f]+$/, `sig=${"0".repeat(64)}`);
    expect((await stream(url, USER)).status).toBe(403);
  });

  it("rejects a signature minted for a different user", async () => {
    const res = await stream(signedAudioUrl(OWNED_KEY, OTHER_USER_ID, expSeconds(600)), null);
    expect(res.status).toBe(403);
  });

  it("rejects a signature for a key no user owns", async () => {
    const res = await stream(signedAudioUrl(FOREIGN_KEY, USER.id, expSeconds(600)), null);
    expect(res.status).toBe(403);
  });

  it("treats a signature parameter without its expiry as invalid", async () => {
    const url = signedAudioUrl(OWNED_KEY, USER.id, expSeconds(600)).replace(/&exp=\d+/, "");
    expect((await stream(url, null)).status).toBe(403);
  });
});

describe("GET /api/audio with a session", () => {
  it("requires authentication when there is no signature and no session", async () => {
    const res = await stream(`/api/audio?key=${encodeURIComponent(OWNED_KEY)}`, null);

    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe("Authentication required");
  });

  it("streams an owned key for a signed-in user", async () => {
    const res = await stream(`/api/audio?key=${encodeURIComponent(OWNED_KEY)}`, USER);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("abcd");
  });

  it("hides a key the user does not own", async () => {
    const res = await stream(`/api/audio?key=${encodeURIComponent(FOREIGN_KEY)}`, USER);
    expect(res.status).toBe(404);
  });
});
