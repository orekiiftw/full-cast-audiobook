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

const BOOK_ID = "00000000-0000-0000-0000-000000000050";
const CHAPTER_ID = "00000000-0000-0000-0000-000000000051";
const FOREIGN_CHAPTER_ID = "00000000-0000-0000-0000-000000000052";
const CHAPTER_INDEX = 3;

const SEGMENT_ROWS = [
  { id: "00000000-0000-0000-0000-000000000053", segmentIndex: 1, rawText: "First.", status: "voiced", audioR2Key: null, durationMs: null },
  {
    id: "00000000-0000-0000-0000-000000000054",
    segmentIndex: 2,
    rawText: "Second.",
    status: "pending",
    audioR2Key: null,
    durationMs: null,
  },
];

const mockDb = {
  select: () => ({
    from: () => ({
      where: () => ({ orderBy: () => Promise.resolve(SEGMENT_ROWS) }),
    }),
  }),
};

mock.module("../../db", () => ({
  db: mockDb,
  pool: { connect: async () => ({ release: () => {} }), on: () => {} },
}));

let chapterLookups = 0;
mock.module("../../books/ownership", () => ({
  ownedBook: async () => ({ id: BOOK_ID }),
  ownedChapter: async (_userId: string, chapterId: string) => {
    chapterLookups++;
    return chapterId === CHAPTER_ID ? { chapter: { id: CHAPTER_ID, bookId: BOOK_ID, chapterIndex: CHAPTER_INDEX } } : undefined;
  },
}));

const lookaheadCalls: Array<[string, { chapterIndex: number; segmentIndex: number }]> = [];
mock.module("../../orchestrator", () => ({
  ensureLookahead: (bookId: string, anchor: { chapterIndex: number; segmentIndex: number }) => {
    lookaheadCalls.push([bookId, anchor]);
    return Promise.resolve();
  },
}));

import { chapterRoutes } from "./chapters";
import { dispatchRoute } from "../testSupport";
import { AuthUser } from "../../auth";
import { ValidationError } from "../../lib/validators";

const testUser: AuthUser = {
  id: "00000000-0000-0000-0000-000000000055",
  email: "chapters@example.com",
};

function segmentsReq(query: string, chapterId = CHAPTER_ID): Request {
  return new Request(`http://localhost/api/chapters/${chapterId}/segments${query}`);
}

async function listSegments(query: string, chapterId = CHAPTER_ID): Promise<Response> {
  lookaheadCalls.length = 0;
  chapterLookups = 0;
  return dispatchRoute(chapterRoutes, segmentsReq(query, chapterId), testUser);
}

describe("chapter segment listing voicing-window anchor", () => {
  it("re-centers the window on the waited-for section when at is sent", async () => {
    const res = await listSegments("?at=2");

    expect(res.status).toBe(200);
    const body = (await res.json()) as { segments: Array<{ segmentIndex: number }> };
    expect(body.segments.map((segment) => segment.segmentIndex)).toEqual([1, 2]);
    expect(lookaheadCalls).toEqual([[BOOK_ID, { chapterIndex: CHAPTER_INDEX, segmentIndex: 2 }]]);
  });

  it("opens nothing when the client lists segments without at", async () => {
    const res = await listSegments("");

    expect(res.status).toBe(200);
    expect(lookaheadCalls).toHaveLength(0);
  });

  it("opens nothing for a chapter the user does not own", async () => {
    const res = await listSegments("?at=2", FOREIGN_CHAPTER_ID);

    expect(res.status).toBe(404);
    expect(lookaheadCalls).toHaveLength(0);
  });

  for (const at of ["0", "-1", "1.5", "1e3", "0x10", "abc", "", " 2", "9007199254740993"]) {
    it(`rejects at=${JSON.stringify(at)} before looking up the chapter`, async () => {
      const error = await listSegments(`?at=${encodeURIComponent(at)}`).then(
        () => null,
        (err: unknown) => err,
      );

      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toBe("Query parameter at must be a positive integer");
      expect(chapterLookups).toBe(0);
      expect(lookaheadCalls).toHaveLength(0);
    });
  }
});
