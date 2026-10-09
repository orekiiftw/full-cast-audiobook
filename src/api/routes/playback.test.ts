import { describe, expect, it, mock } from "bun:test";

class FakeRedis {
  on() {}
  set() {
    return Promise.resolve("OK");
  }
  del() {
    return Promise.resolve(0);
  }
  publish() {
    return Promise.resolve(0);
  }
  subscribe() {
    return Promise.resolve(undefined);
  }
  quit() {
    return Promise.resolve("OK");
  }
}
mock.module("ioredis", () => ({ Redis: FakeRedis, default: FakeRedis }));

const BOOK_ID = "00000000-0000-0000-0000-000000000040";
const CHAPTER_ID = "00000000-0000-0000-0000-000000000041";
const CHAPTER_INDEX = 7;

let upserts = 0;
const mockDb = {
  insert: () => ({
    values: () => {
      upserts++;
      return { onConflictDoUpdate: () => Promise.resolve([]) };
    },
  }),
};

mock.module("../../db", () => ({
  db: mockDb,
  pool: { connect: async () => ({ release: () => {} }), on: () => {} },
}));
mock.module("../../books/ownership", () => ({
  ownedBook: async () => ({ id: BOOK_ID }),
  ownedChapter: async () => ({ chapter: { id: CHAPTER_ID, bookId: BOOK_ID, chapterIndex: CHAPTER_INDEX } }),
}));

const anchorLookaheadCalls: Array<[string, { chapterIndex: number; segmentIndex: number }]> = [];
mock.module("../../orchestrator", () => ({
  ensureLookahead: (bookId: string, anchor: { chapterIndex: number; segmentIndex: number }) => {
    anchorLookaheadCalls.push([bookId, anchor]);
    return Promise.resolve();
  },
}));

import { playbackRoutes } from "./playback";
import { dispatchRoute } from "../testSupport";
import { AuthUser } from "../../auth";

const testUser: AuthUser = {
  id: "00000000-0000-0000-0000-000000000042",
  email: "playback@example.com",
};

function syncReq(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/playback", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookId: BOOK_ID, chapterId: CHAPTER_ID, positionMs: 1000, ...body }),
  });
}

async function runSync(body: Record<string, unknown>) {
  anchorLookaheadCalls.length = 0;
  upserts = 0;
  const res = await dispatchRoute(playbackRoutes, syncReq(body), testUser);
  expect(res.status).toBe(200);
  await Promise.resolve();
  return res;
}

describe("playback sync voicing-window re-centering", () => {
  it("re-centers the just-in-time window on the playing line when segmentIndex is sent", async () => {
    await runSync({ segmentIndex: 42 });
    expect(anchorLookaheadCalls).toEqual([[BOOK_ID, { chapterIndex: CHAPTER_INDEX, segmentIndex: 42 }]]);
  });

  it("stores the position and makes exactly one section-anchored lookahead call per sync", async () => {
    await runSync({ segmentIndex: 43 });
    expect(upserts).toBe(1);
    expect(anchorLookaheadCalls).toEqual([[BOOK_ID, { chapterIndex: CHAPTER_INDEX, segmentIndex: 43 }]]);
  });

  it("does not re-center when the client omits segmentIndex", async () => {
    await runSync({});
    expect(anchorLookaheadCalls).toHaveLength(0);
    expect(upserts).toBe(1);
  });

  it("rejects a non-positive segmentIndex before touching playback state", async () => {
    upserts = 0;
    await expect(dispatchRoute(playbackRoutes, syncReq({ segmentIndex: 0 }), testUser)).rejects.toThrow(
      /segmentIndex must be a positive integer/,
    );
    expect(upserts).toBe(0);
  });
});
