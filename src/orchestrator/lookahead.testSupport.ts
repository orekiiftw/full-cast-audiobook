import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Database } from "bun:sqlite";
import type { Job } from "bullmq";
import { getTableColumns, getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { books, chapters, segments } from "../schema";
import { PIPELINE } from "../lib/constants";
import type { SegmentJobData } from "../queue";
import type { PlannedChapter } from "./ingestion/planning";

const sqlite = new Database(":memory:");
for (const table of [books, chapters, segments]) {
  const columns = Object.values(getTableColumns(table)).map((column) => {
    const type = column.getSQLType() === "integer" ? "INTEGER DEFAULT 0" : "TEXT";
    return `"${column.name}" ${type}${column.primary ? " PRIMARY KEY DEFAULT (lower(hex(randomblob(16))))" : ""}`;
  });
  sqlite.exec(`CREATE TABLE "${getTableName(table)}" (${columns.join(", ")})`);
}

const testDb = drizzle(async (query, params) => ({
  rows: sqlite
    .query(
      query
        .replace(/\$\d+/g, "?")
        .replace(/\(default,/g, "(lower(hex(randomblob(16))),")
        .replace(/\bdefault\b/g, "NULL"),
    )
    .values(...params),
}));
mock.module("../db", () => ({ db: testDb }));

const enqueued: SegmentJobData[] = [];
const stitches: string[] = [];
const lifted: string[] = [];
let rejectEnqueue = false;
let queueDepth = 0;
let onGetJob: (id: string) => void = () => {};
mock.module("../queue", () => ({
  enqueueSegmentJobs: async (tasks: SegmentJobData[]) => {
    if (rejectEnqueue) throw new Error("Queue unavailable");
    enqueued.push(...tasks);
  },
  enqueueStitch: async (task: { chapterId: string }) => {
    stitches.push(task.chapterId);
  },
  emitProgressEvent: () => {},
  invalidateBookVoiceContextClusterwide: () => {},
  isLockHeld: async () => false,
  segmentJobId: (id: string) => id,
  ingestJobId: (id: string) => id,
  segmentQueue: {
    getJob: async (id: string) => {
      onGetJob(id);
      return { getState: async () => "unknown", remove: async () => {}, changePriority: async () => lifted.push(id) };
    },
    getJobCounts: async () => ({ wait: queueDepth, active: 0, delayed: 0, prioritized: 0 }),
  },
  ingestionQueue: { getJob: async () => null },
}));
mock.module("../narration/voiceContext", () => ({
  getBookVoiceContext: async () => ({ narratorId: null, narratorVoice: "Mia", narratorBaseStyle: "", pDict: {} }),
}));
mock.module("../narration/voiceSegment", () => ({
  synthesizeSegmentAudio: async () => ({ wav: Buffer.from([1]), durationMs: 1000 }),
}));
mock.module("../storage/r2", () => ({ uploadFile: async () => {}, deleteFile: async () => {} }));
mock.module("./segment/annotation", () => ({ loadSegmentBeats: async () => [] }));

const { ensureChapterLookahead, ensureLookahead, prefetchNextChapter } = await import("./lookahead");
const { runPipelineSweep } = await import("./sweep");
const { runSegmentJob } = await import("./segment");
const { reportSegmentFailure } = await import("./segment/failure");
const { insertSegmentRows } = await import("./ingestion/persistence");

let bookId: string;
let bookNumber = 0;
const chapterCount = 10;
const segmentsPerChapter = PIPELINE.LOOKAHEAD_SEGMENTS + 3;

afterAll(() => sqlite.close());

beforeEach(() => {
  sqlite.exec("DELETE FROM segments; DELETE FROM chapters; DELETE FROM books");
  bookId = `book-${++bookNumber}`;
  sqlite.query("INSERT INTO books (id, status, created_at) VALUES (?, 'in_progress', ?)").run(bookId, new Date().toISOString());
  for (let chapterIndex = 1; chapterIndex <= chapterCount; chapterIndex++) {
    const chapterId = `${bookId}-chapter-${chapterIndex}`;
    sqlite
      .query("INSERT INTO chapters (id, book_id, chapter_index, status, total_count) VALUES (?, ?, ?, 'queued', ?)")
      .run(chapterId, bookId, chapterIndex, segmentsPerChapter);
    for (let segmentIndex = 1; segmentIndex <= segmentsPerChapter; segmentIndex++) {
      sqlite
        .query("INSERT INTO segments (id, chapter_id, segment_index, status, raw_text) VALUES (?, ?, ?, 'pending', 'Hello')")
        .run(`${chapterId}-segment-${segmentIndex}`, chapterId, segmentIndex);
    }
  }
  enqueued.length = 0;
  stitches.length = 0;
  lifted.length = 0;
  rejectEnqueue = false;
  queueDepth = 0;
  onGetJob = () => {};
});

function segmentStatus(chapterIndex: number, segmentIndex = 1) {
  return sqlite.query<{ status: string }, [string]>("SELECT status FROM segments WHERE id = ?").get(segmentId(chapterIndex, segmentIndex))
    ?.status;
}

function segmentId(chapterIndex: number, segmentIndex = 1) {
  return `${bookId}-chapter-${chapterIndex}-segment-${segmentIndex}`;
}

function job(chapterIndex: number, segmentIndex = 1, attemptsMade = 0) {
  return {
    data: {
      bookId,
      chapterId: `${bookId}-chapter-${chapterIndex}`,
      chapterIndex,
      segmentId: segmentId(chapterIndex, segmentIndex),
      segmentIndex,
    },
    attemptsMade,
  } as Job<SegmentJobData>;
}

describe("listener-driven chapter buffer", () => {
  it("promotes exactly the inclusive current chapter through CHAPTER_LOOKAHEAD ahead", async () => {
    expect(PIPELINE.CHAPTER_LOOKAHEAD).toBe(Number(process.env.CHAPTER_LOOKAHEAD) || 4);
    const current = 3;
    sqlite.query("INSERT INTO chapters (id, book_id, chapter_index) VALUES ('other-chapter', 'other-book', ?)").run(current);
    sqlite
      .query("INSERT INTO segments (id, chapter_id, segment_index, status) VALUES ('other-segment', 'other-chapter', 1, 'pending')")
      .run();
    await ensureChapterLookahead(bookId, current);
    for (let chapterIndex = 1; chapterIndex <= chapterCount; chapterIndex++) {
      const eligible = chapterIndex >= current && chapterIndex <= current + PIPELINE.CHAPTER_LOOKAHEAD;
      for (let segmentIndex = 1; segmentIndex <= segmentsPerChapter; segmentIndex++) {
        expect(segmentStatus(chapterIndex, segmentIndex)).toBe(eligible ? "queued" : "pending");
      }
    }
    expect(enqueued).toHaveLength((PIPELINE.CHAPTER_LOOKAHEAD + 1) * segmentsPerChapter);
    expect(new Set(enqueued.map((task) => task.segmentId)).size).toBe(enqueued.length);
    expect(sqlite.query<{ status: string }, []>("SELECT status FROM segments WHERE id = 'other-segment'").get()?.status).toBe("pending");
  });

  it("only opens the newly eligible chapter after the listener advances", async () => {
    const current = 2;
    const newlyEligible = current + 1 + PIPELINE.CHAPTER_LOOKAHEAD;
    await ensureChapterLookahead(bookId, current);
    expect(segmentStatus(newlyEligible)).toBe("pending");
    enqueued.length = 0;
    await ensureChapterLookahead(bookId, current + 1);
    expect(enqueued).toHaveLength(segmentsPerChapter);
    expect(enqueued.every((task) => task.chapterIndex === newlyEligible)).toBe(true);
    expect(segmentStatus(newlyEligible + 1)).toBe("pending");
  });

  it("cannot scan beyond a full chapter buffer, even with forced segment lookahead", async () => {
    const current = 2;
    await ensureChapterLookahead(bookId, current);
    sqlite.query("UPDATE segments SET status = 'voiced' WHERE status = 'queued'").run();
    enqueued.length = 0;
    await ensureLookahead(bookId, { chapterIndex: current, segmentIndex: 1 }, { force: true });
    await ensureLookahead(bookId, { chapterIndex: current, segmentIndex: segmentsPerChapter }, { force: true });
    expect(enqueued).toHaveLength(0);
    expect(segmentStatus(current + PIPELINE.CHAPTER_LOOKAHEAD + 1)).toBe("pending");
  });

  it("promotes the entire current chapter even when buffer evaluation is throttled", async () => {
    queueDepth = 1000;
    await ensureChapterLookahead(bookId, 2);
    sqlite
      .query("UPDATE segments SET status = 'pending' WHERE chapter_id IN (?, ?)")
      .run(`${bookId}-chapter-2`, `${bookId}-chapter-${2 + PIPELINE.CHAPTER_LOOKAHEAD}`);
    enqueued.length = 0;
    await ensureChapterLookahead(bookId, 2);
    expect(enqueued).toHaveLength(segmentsPerChapter);
    expect(enqueued.every((task) => task.chapterIndex === 2)).toBe(true);
    expect(segmentStatus(2, segmentsPerChapter)).toBe("queued");
    expect(segmentStatus(2 + PIPELINE.CHAPTER_LOOKAHEAD)).toBe("pending");
    await ensureChapterLookahead(bookId, 2, { force: true });
    expect(segmentStatus(2 + PIPELINE.CHAPTER_LOOKAHEAD)).toBe("queued");
  });

  it("restores pending rows after an enqueue failure and can immediately retry the current chapter", async () => {
    rejectEnqueue = true;
    await expect(ensureChapterLookahead(bookId, 2)).rejects.toThrow("Queue unavailable");
    expect(segmentStatus(2)).toBe("pending");
    rejectEnqueue = false;
    await ensureChapterLookahead(bookId, 2);
    expect(segmentStatus(2, segmentsPerChapter)).toBe("queued");
    expect(segmentStatus(2 + PIPELINE.CHAPTER_LOOKAHEAD + 1)).toBe("pending");
  });

  it("keeps ingestion priming limited to the opening LOOKAHEAD_SEGMENTS", async () => {
    sqlite.exec("DELETE FROM segments");
    const planned: PlannedChapter[] = Array.from({ length: chapterCount }, (_, index) => ({
      chapter: { chapterIndex: index + 1, title: `Chapter ${index + 1}`, blocks: [], wordCount: 1000 },
      segments: Array.from({ length: segmentsPerChapter }, (_, segmentIndex) => ({
        segmentIndex: segmentIndex + 1,
        text: "Hello",
        wordCount: 1,
        isSceneBreak: false,
      })),
    }));
    await insertSegmentRows(
      planned,
      new Map(planned.map(({ chapter }) => [chapter.chapterIndex, `${bookId}-chapter-${chapter.chapterIndex}`])),
    );
    await ensureLookahead(bookId);
    expect(enqueued).toHaveLength(PIPELINE.LOOKAHEAD_SEGMENTS);
    expect(enqueued.every((task) => task.chapterIndex === 1)).toBe(true);
    const primed = [...enqueued];
    const pendingCount = () =>
      sqlite.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM segments WHERE status = 'pending'").get()?.count;
    expect(pendingCount()).toBe(chapterCount * segmentsPerChapter - PIPELINE.LOOKAHEAD_SEGMENTS);
    await runPipelineSweep();
    for (const data of primed) {
      await runSegmentJob({ data, attemptsMade: 0 } as Job<SegmentJobData>);
    }
    expect(pendingCount()).toBe(chapterCount * segmentsPerChapter - PIPELINE.LOOKAHEAD_SEGMENTS);
  });

  it("sweep refills only already-queued work, including rows outside the current window", async () => {
    const outside = 2 + PIPELINE.CHAPTER_LOOKAHEAD + 1;
    sqlite.query("UPDATE segments SET status = 'queued' WHERE id = ?").run(segmentId(outside));
    await runPipelineSweep();
    expect(enqueued.length).toBeGreaterThan(0);
    expect(enqueued.every((task) => task.segmentId === segmentId(outside))).toBe(true);
    expect(segmentStatus(outside, 2)).toBe("pending");
    expect(segmentStatus(2)).toBe("pending");
  });

  it("prefetch only lifts queued jobs without opening the next chapter", async () => {
    sqlite.query("UPDATE segments SET status = 'queued' WHERE id = ?").run(segmentId(3));
    await prefetchNextChapter(bookId, 2);
    expect(lifted).toEqual([segmentId(3)]);
    expect(enqueued).toHaveLength(0);
    expect(segmentStatus(3, 2)).toBe("pending");
  });

  it("segment completion never moves the listener window or promotes pending rows", async () => {
    await ensureChapterLookahead(bookId, 2);
    enqueued.length = 0;
    const lastEligible = 2 + PIPELINE.CHAPTER_LOOKAHEAD;
    for (let segmentIndex = 1; segmentIndex <= segmentsPerChapter; segmentIndex++) {
      await runSegmentJob(job(lastEligible, segmentIndex));
    }
    expect(segmentStatus(lastEligible, segmentsPerChapter)).toBe("voiced");
    expect(stitches).toEqual([`${bookId}-chapter-${lastEligible}`]);
    await runPipelineSweep();
    expect(enqueued.every((task) => task.chapterIndex <= lastEligible)).toBe(true);
    expect(segmentStatus(lastEligible + 1)).toBe("pending");
  });

  it("a stray segment job cannot claim or retry a pending row outside the window", async () => {
    const outside = 2 + PIPELINE.CHAPTER_LOOKAHEAD + 1;
    await runSegmentJob(job(outside));
    await runSegmentJob(job(outside, 1, 1));
    await expect(reportSegmentFailure(job(outside), new Error("Stale job"))).rejects.toThrow("Stale job");
    expect(segmentStatus(outside)).toBe("pending");
    expect(enqueued).toHaveLength(0);
  });

  it("a segment retry or permanent failure never opens a future chapter", async () => {
    const lastEligible = 2 + PIPELINE.CHAPTER_LOOKAHEAD;
    sqlite.query("UPDATE segments SET status = 'processing' WHERE id = ?").run(segmentId(lastEligible));
    await expect(reportSegmentFailure(job(lastEligible), new Error("TTS unavailable"))).rejects.toThrow("TTS unavailable");
    expect(segmentStatus(lastEligible)).toBe("queued");
    await expect(
      reportSegmentFailure(job(lastEligible, 1, PIPELINE.MAX_SEGMENT_ATTEMPTS - 1), new Error("TTS unavailable")),
    ).rejects.toThrow("TTS unavailable");
    expect(segmentStatus(lastEligible)).toBe("failed");
    expect(segmentStatus(lastEligible + 1)).toBe("pending");
    expect(enqueued).toHaveLength(0);
  });

  it("orphan recovery does not requeue a row that became pending after the sweep read", async () => {
    const outside = 2 + PIPELINE.CHAPTER_LOOKAHEAD + 1;
    sqlite.query("UPDATE segments SET status = 'processing' WHERE id = ?").run(segmentId(outside));
    onGetJob = (id) => {
      sqlite.query("UPDATE segments SET status = 'pending' WHERE id = ?").run(id);
    };
    await runPipelineSweep();
    expect(segmentStatus(outside)).toBe("pending");
    expect(enqueued).toHaveLength(0);
  });
});
