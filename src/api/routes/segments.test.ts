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

let prevStatus: string = "pending";
let chapterSetPayloads: Record<string, unknown>[] = [];

const SEG_ID = "00000000-0000-0000-0000-000000000030";
const CHAPTER_ID = "00000000-0000-0000-0000-000000000031";
const BOOK_ID = "00000000-0000-0000-0000-000000000032";

import { chapters, segments } from "../../schema";

const COUNTERS = { voicedCount: 1, failedCount: 0, totalCount: 1 };

const mockDb = {
  update: (table: unknown) => {
    if (table === segments) {
      return {
        set: () => {
          const counted = Object.assign(Promise.resolve([]), {
            returning: () => Promise.resolve([{ id: SEG_ID }]),
          });
          return { where: () => counted };
        },
      };
    }
    if (table === chapters) {
      return {
        set: (payload: Record<string, unknown>) => {
          chapterSetPayloads.push(payload);
          const counted = Object.assign(Promise.resolve([]), {
            returning: () => Promise.resolve([COUNTERS]),
          });
          return { where: () => counted };
        },
      };
    }
    throw new Error("Unexpected table in segments.test mock");
  },
  select: () => ({
    from: () => ({
      where: () => Promise.resolve([COUNTERS]),
    }),
  }),
};

mock.module("../../db", () => ({
  db: mockDb,
  pool: { connect: async () => ({ release: () => {} }), on: () => {} },
}));
mock.module("../../books/ownership", () => ({
  ownedSegment: async () => ({
    segment: {
      id: SEG_ID,
      chapterId: CHAPTER_ID,
      segmentIndex: 0,
      rawText: "Hello there.",
      annotatedJson: { beats: [{ text: "Hello there.", style: "warm" }] },
      status: prevStatus,
    },
    chapter: { id: CHAPTER_ID, bookId: BOOK_ID, chapterIndex: 1, status: "processing" },
  }),
}));
mock.module("../../queue", () => ({
  acquireLock: async () => "tok",
  releaseLock: async () => {},
  segmentQueue: { remove: async () => {} },
  segmentJobId: (id: string) => `job:${id}`,
}));
mock.module("../../orchestrator", () => ({
  emitProgressEvent: () => {},
  restitchChapterInBackground: () => {},
}));
mock.module("../../storage/r2", () => ({
  uploadFile: async () => {},
}));
mock.module("../../narration/annotation", () => ({
  annotateSegment: async () => ({ beats: [] }),
  extractBeats: () => [{ text: "Hello there.", style: "warm" }],
}));
mock.module("../../narration/voiceSegment", () => ({
  synthesizeSegmentAudio: async () => ({ wav: Buffer.from([1]), durationMs: 1000 }),
}));
mock.module("../../narration/voiceContext", () => ({
  getBookVoiceContext: async () => ({ narratorVoice: "Mia", narratorBaseStyle: "base", pDict: {} }),
}));

import { segmentRoutes } from "./segments";
import { dispatchRoute } from "../testSupport";
import { AuthUser } from "../../auth";

const testUser: AuthUser = {
  id: "00000000-0000-0000-0000-000000000011",
  email: "segs@example.com",
};

function regenReq(): Request {
  return new Request(`http://localhost/api/segments/${SEG_ID}/regenerate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

async function runRegen(fromStatus: string) {
  prevStatus = fromStatus;
  chapterSetPayloads = [];
  const res = await dispatchRoute(segmentRoutes, regenReq(), testUser);
  expect(res.status).toBe(200);
  return chapterSetPayloads;
}

describe("segment regeneration chapter-counter repair", () => {
  it("increments voicedCount (and never touches failedCount) when the previous status was pending", async () => {
    const payloads = await runRegen("pending");
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toHaveProperty("voicedCount");
    expect(payloads[0]).not.toHaveProperty("failedCount");
  });

  it("increments voicedCount for a queued segment whose pipeline job was removed", async () => {
    const payloads = await runRegen("queued");
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toHaveProperty("voicedCount");
  });

  it("moves failed -> voiced with both counter adjustments", async () => {
    const payloads = await runRegen("failed");
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toHaveProperty("voicedCount");
    expect(payloads[0]).toHaveProperty("failedCount");
  });

  it("leaves counters untouched when re-voicing an already-voiced line", async () => {
    const payloads = await runRegen("voiced");
    expect(payloads).toHaveLength(0);
  });
});
