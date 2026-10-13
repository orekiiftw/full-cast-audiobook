import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import * as database from "../../db";
import * as ownership from "../../books/ownership";
import * as queue from "../../queue";
import * as orchestrator from "../../orchestrator";
import * as r2 from "../../storage/r2";
import * as annotation from "../../narration/annotation";
import * as voiceSegment from "../../narration/voiceSegment";
import * as voiceContext from "../../narration/voiceContext";

// Mocks patch the loaded modules for the rest of the test process, so put the real exports back afterwards.
const originals = {
  database: { ...database },
  ownership: { ...ownership },
  queue: { ...queue },
  orchestrator: { ...orchestrator },
  r2: { ...r2 },
  annotation: { ...annotation },
  voiceSegment: { ...voiceSegment },
  voiceContext: { ...voiceContext },
};
afterAll(() => {
  mock.module("../../db", () => originals.database);
  mock.module("../../books/ownership", () => originals.ownership);
  mock.module("../../queue", () => originals.queue);
  mock.module("../../orchestrator", () => originals.orchestrator);
  mock.module("../../storage/r2", () => originals.r2);
  mock.module("../../narration/annotation", () => originals.annotation);
  mock.module("../../narration/voiceSegment", () => originals.voiceSegment);
  mock.module("../../narration/voiceContext", () => originals.voiceContext);
});

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

interface VoicedAudio {
  wav: Buffer;
  durationMs: number;
}

let prevStatus: string = "pending";
let chapterSetPayloads: Record<string, unknown>[] = [];
let segmentTransitions: string[] = [];
let segmentRowMatches = true;
let synthesizeCalls = 0;
let synthesize: () => Promise<VoicedAudio> = voiceLine;
let upload: () => Promise<void> = async () => {};
const heldLocks = new Map<string, string>();

const SEG_ID = "00000000-0000-0000-0000-000000000030";
const CHAPTER_ID = "00000000-0000-0000-0000-000000000031";
const BOOK_ID = "00000000-0000-0000-0000-000000000032";

import { chapters, segments } from "../../schema";

const COUNTERS = { voicedCount: 1, failedCount: 0, totalCount: 1 };

const dialect = new PgDialect();

async function voiceLine(): Promise<VoicedAudio> {
  return { wav: Buffer.from([1]), durationMs: 1000 };
}

async function failSynthesis(): Promise<VoicedAudio> {
  throw new Error("TTS provider unavailable");
}

// Renders a segments update as "<status it must currently have> -> <status it sets>".
function transition(payload: Record<string, unknown>, condition: SQL): string {
  const { sql, params } = dialect.sqlToQuery(condition);
  const guard = /"segments"\."status" = \$(\d+)/.exec(sql);
  return `${guard ? params[Number(guard[1]) - 1] : "any"} -> ${payload.status}`;
}

const mockDb = {
  update: (table: unknown) => {
    if (table === segments) {
      return {
        set: (payload: Record<string, unknown>) => ({
          where: (condition: SQL) => {
            segmentTransitions.push(transition(payload, condition));
            return Object.assign(Promise.resolve([]), {
              returning: () => Promise.resolve(segmentRowMatches ? [{ id: SEG_ID }] : []),
            });
          },
        }),
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
  acquireLock: async (name: string) => {
    if (heldLocks.has(name)) return null;
    heldLocks.set(name, `tok:${name}`);
    return `tok:${name}`;
  },
  releaseLock: async (name: string, token: string) => {
    if (heldLocks.get(name) === token) heldLocks.delete(name);
  },
  isLockHeld: async (name: string) => heldLocks.has(name),
  emitProgressEvent: () => {},
  segmentQueue: { remove: async () => {} },
  segmentJobId: (id: string) => `job:${id}`,
}));
mock.module("../../orchestrator", () => ({
  emitProgressEvent: () => {},
  restitchChapterInBackground: () => {},
}));
mock.module("../../storage/r2", () => ({
  uploadFile: async () => upload(),
}));
mock.module("../../narration/annotation", () => ({
  annotateSegment: async () => ({ beats: [] }),
  extractBeats: () => [{ text: "Hello there.", style: "warm" }],
}));
mock.module("../../narration/voiceSegment", () => ({
  synthesizeSegmentAudio: async () => {
    synthesizeCalls++;
    return synthesize();
  },
}));
mock.module("../../narration/voiceContext", () => ({
  getBookVoiceContext: async () => ({ narratorVoice: "Mia", narratorBaseStyle: "base", pDict: {} }),
}));

import { segmentRoutes } from "./segments";
import { dispatchRoute } from "../testSupport";
import { AuthUser } from "../../auth";

let userNumber = 100;

// Each request comes from a new user so the per-user throttle only shows up in its own test.
function freshUser(): AuthUser {
  userNumber++;
  return { id: `00000000-0000-0000-0000-${String(userNumber).padStart(12, "0")}`, email: `segs-${userNumber}@example.com` };
}

function regenReq(): Request {
  return new Request(`http://localhost/api/segments/${SEG_ID}/regenerate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

function regenerate(user: AuthUser = freshUser()): Promise<Response> {
  return dispatchRoute(segmentRoutes, regenReq(), user);
}

async function runRegen(fromStatus: string) {
  prevStatus = fromStatus;
  const res = await regenerate();
  expect(res.status).toBe(200);
  return chapterSetPayloads;
}

async function errorOf(res: Response): Promise<string> {
  return ((await res.json()) as { error: string }).error;
}

beforeEach(() => {
  heldLocks.clear();
  chapterSetPayloads = [];
  segmentTransitions = [];
  segmentRowMatches = true;
  synthesizeCalls = 0;
  synthesize = voiceLine;
  upload = async () => {};
});

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

describe("segment regeneration claim", () => {
  for (const status of ["pending", "queued", "failed"]) {
    it(`claims a ${status} line only while it is still ${status}`, async () => {
      await runRegen(status);
      expect(segmentTransitions).toEqual([`${status} -> processing`, "processing -> voiced"]);
    });
  }

  it("re-voices a voiced line without ever taking it out of voiced", async () => {
    await runRegen("voiced");
    expect(segmentTransitions).toEqual(["voiced -> voiced", "voiced -> voiced"]);
  });

  for (const status of ["processing", "annotated"]) {
    it(`refuses a line the segment worker is voicing (${status})`, async () => {
      prevStatus = status;
      const res = await regenerate();
      expect(res.status).toBe(409);
      expect(synthesizeCalls).toBe(0);
      expect(segmentTransitions).toEqual([]);
    });
  }

  it("backs off when the line changed after the route read it", async () => {
    prevStatus = "queued";
    segmentRowMatches = false;
    const res = await regenerate();
    expect(res.status).toBe(409);
    expect(synthesizeCalls).toBe(0);
  });

  it("does not publish or count audio for a line the pipeline took over during synthesis", async () => {
    prevStatus = "pending";
    synthesize = async () => {
      segmentRowMatches = false;
      return voiceLine();
    };
    const res = await regenerate();
    expect(res.status).toBe(409);
    expect(chapterSetPayloads).toHaveLength(0);
  });
});

describe("segment regeneration failures", () => {
  for (const status of ["pending", "queued", "failed"]) {
    it(`puts a ${status} line back to ${status} when synthesis throws, leaving counters alone`, async () => {
      prevStatus = status;
      synthesize = failSynthesis;
      await expect(regenerate()).rejects.toThrow("TTS provider unavailable");
      expect(segmentTransitions).toEqual([`${status} -> processing`, `processing -> ${status}`]);
      expect(chapterSetPayloads).toHaveLength(0);
    });
  }

  it("puts the line back when the audio upload fails", async () => {
    prevStatus = "failed";
    upload = async () => {
      throw new Error("R2 unavailable");
    };
    await expect(regenerate()).rejects.toThrow("R2 unavailable");
    expect(segmentTransitions).toEqual(["failed -> processing", "processing -> failed"]);
    expect(chapterSetPayloads).toHaveLength(0);
  });

  it("keeps a voiced line voiced, with counters untouched, when synthesis throws", async () => {
    prevStatus = "voiced";
    synthesize = failSynthesis;
    await expect(regenerate()).rejects.toThrow("TTS provider unavailable");
    expect(segmentTransitions).toEqual(["voiced -> voiced"]);
    expect(chapterSetPayloads).toHaveLength(0);
  });

  it("lets the user retry straight away after a failure", async () => {
    prevStatus = "voiced";
    synthesize = failSynthesis;
    await expect(regenerate()).rejects.toThrow("TTS provider unavailable");
    expect(heldLocks.size).toBe(0);

    synthesize = voiceLine;
    expect((await regenerate()).status).toBe(200);
  });
});

describe("segment regeneration throttling", () => {
  it("refuses an immediate repeat of a successful regeneration without synthesizing again", async () => {
    prevStatus = "voiced";
    expect((await regenerate()).status).toBe(200);

    const repeat = await regenerate();
    expect(repeat.status).toBe(429);
    expect(await errorOf(repeat)).toContain("just regenerated");
    expect(synthesizeCalls).toBe(1);

    heldLocks.clear(); // the cooldown's TTL lapses
    expect((await regenerate()).status).toBe(200);
    expect(synthesizeCalls).toBe(2);
  });

  it("caps each user at 30 regeneration requests per 15 minutes", async () => {
    prevStatus = "voiced";
    const user = freshUser();
    for (let i = 0; i < 30; i++) {
      heldLocks.clear(); // step past the per-line cooldown so every request reaches synthesis
      expect((await regenerate(user)).status).toBe(200);
    }

    heldLocks.clear();
    const throttled = await regenerate(user);
    expect(throttled.status).toBe(429);
    expect(await errorOf(throttled)).toContain("Too many regeneration requests");
    expect(synthesizeCalls).toBe(30);

    expect((await regenerate()).status).toBe(200);
  });
});
