import { afterAll, beforeEach, describe, expect, it, mock, setSystemTime } from "bun:test";
import { Database } from "bun:sqlite";
import type { Job } from "bullmq";
import { getTableConfig, type PgColumn } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pg-proxy";
import { books, castMembers, chapters, segments } from "../schema";
import { PIPELINE } from "../lib/constants";
import type { IngestionJobData, SegmentJobData } from "../queue";

const WINDOW_SIZE = PIPELINE.LOOKAHEAD_SEGMENTS + 1;
const CHAPTER_COUNT = 4;
const SEGMENTS_PER_CHAPTER = WINDOW_SIZE + 2;
const SECTION_COUNT = CHAPTER_COUNT * SEGMENTS_PER_CHAPTER;
const PAST_THROTTLE_MS = 2_500;

const sqlite = new Database(":memory:");
for (const table of [books, castMembers, chapters, segments]) {
  const { name, columns, uniqueConstraints } = getTableConfig(table);
  const uniques = uniqueConstraints.map((unique) => `UNIQUE (${unique.columns.map((column) => `"${column.name}"`).join(", ")})`);
  sqlite.exec(`CREATE TABLE "${name}" (${[...columns.map(sqliteColumn), ...uniques].join(", ")})`);
}

let beforeQuery: (query: string) => void = () => {};
const testDb = drizzle(async (query, params) => {
  beforeQuery(query);
  return { rows: sqlite.query(toSqliteDialect(query)).values(...params) };
});
mock.module("../db", () => ({ db: testDb }));

const enqueued: Array<SegmentJobData & { priority?: number }> = [];
const lifted: string[] = [];
let rejectEnqueue = false;
let onGetJob: (segmentId: string) => void = () => {};
mock.module("../queue", () => ({
  enqueueSegmentJobs: async (tasks: SegmentJobData[], priority?: number) => {
    if (rejectEnqueue) throw new Error("Queue unavailable");
    enqueued.push(...tasks.map((task) => ({ ...task, priority })));
  },
  enqueueStitch: async () => {},
  enqueueIngestion: async () => {},
  removeBookJobs: async () => {},
  emitProgressEvent: () => {},
  invalidateBookVoiceContextClusterwide: () => {},
  isLockHeld: async () => false,
  segmentJobId: (segmentId: string) => segmentId,
  ingestJobId: (bookId: string) => bookId,
  segmentQueue: {
    getJob: async (segmentId: string) => {
      onGetJob(segmentId);
      return {
        getState: async () => "unknown",
        remove: async () => {},
        changePriority: async () => {
          lifted.push(segmentId);
        },
      };
    },
    getJobCounts: async () => ({ wait: 0, active: 0, delayed: 0, prioritized: 0 }),
  },
  ingestionQueue: { getJob: async () => null },
}));
mock.module("../narration/voiceContext", () => ({
  getBookVoiceContext: async () => ({ narratorId: null, narratorVoice: "Mia", narratorBaseStyle: "", pDict: {} }),
}));
mock.module("../narration/voiceSegment", () => ({
  synthesizeSegmentAudio: async () => ({ wav: Buffer.from([1]), durationMs: 1000 }),
}));
mock.module("../storage/r2", () => ({ uploadFile: async () => {}, deleteFile: async () => {}, deleteFiles: async () => {} }));
mock.module("./segment/annotation", () => ({ loadSegmentBeats: async () => [] }));
mock.module("./ingestion/acquisition", () => ({ resolveEpubBuffer: async () => Buffer.alloc(0) }));
mock.module("../epub", () => ({
  parseEpub: () => ({
    title: "Lookahead",
    author: "Harness",
    chapters: Array.from({ length: CHAPTER_COUNT }, (_, index) => ({ chapterIndex: index + 1, title: `Chapter ${index + 1}`, blocks: [] })),
  }),
}));
mock.module("../narration/segmenter", () => ({
  segmentChapter: () =>
    Array.from({ length: SEGMENTS_PER_CHAPTER }, (_, index) => ({ segmentIndex: index + 1, text: "Hello", isSceneBreak: false })),
}));

const lookahead = await import("./lookahead");
const { ensureLookahead } = lookahead;
const { runIngestionJob } = await import("./ingestion");
const { runPipelineSweep } = await import("./sweep");
const { resumePendingWork } = await import("./recovery");
const { runSegmentJob } = await import("./segment");
const { reportSegmentFailure } = await import("./segment/failure");

let bookId = "";
let bookNumber = 0;
let clock = Date.parse("2026-01-01T00:00:00Z");

afterAll(() => {
  setSystemTime();
  sqlite.close();
});

beforeEach(() => {
  sqlite.exec("DELETE FROM segments; DELETE FROM chapters; DELETE FROM cast_members; DELETE FROM books");
  bookId = `book-${++bookNumber}`;
  sqlite.query("INSERT INTO books (id, status) VALUES (?, 'in_progress')").run(bookId);
  for (let chapterIndex = 1; chapterIndex <= CHAPTER_COUNT; chapterIndex++) {
    sqlite
      .query("INSERT INTO chapters (id, book_id, chapter_index, status, total_count) VALUES (?, ?, ?, 'queued', ?)")
      .run(chapterId(chapterIndex), bookId, chapterIndex, SEGMENTS_PER_CHAPTER);
    for (let segmentIndex = 1; segmentIndex <= SEGMENTS_PER_CHAPTER; segmentIndex++) {
      sqlite
        .query("INSERT INTO segments (id, chapter_id, segment_index, status, raw_text) VALUES (?, ?, ?, 'pending', 'Hello')")
        .run(segmentId(chapterIndex, segmentIndex), chapterId(chapterIndex), segmentIndex);
    }
  }
  enqueued.length = 0;
  lifted.length = 0;
  rejectEnqueue = false;
  onGetJob = () => {};
  beforeQuery = () => {};
  passThrottle();
});

describe("section lookahead window", () => {
  it("promotes exactly the anchor section and the LOOKAHEAD_SEGMENTS sections after it", async () => {
    expect(PIPELINE.LOOKAHEAD_SEGMENTS).toBe(Number(process.env.LOOKAHEAD_SEGMENTS) || 4);
    sqlite.query("INSERT INTO chapters (id, book_id, chapter_index) VALUES ('other-chapter', 'other-book', 2)").run();
    sqlite
      .query("INSERT INTO segments (id, chapter_id, segment_index, status) VALUES ('other-segment', 'other-chapter', 3, 'pending')")
      .run();

    await ensureLookahead(bookId, { chapterIndex: 2, segmentIndex: 2 });

    const window = Array.from({ length: PIPELINE.LOOKAHEAD_SEGMENTS + 1 }, (_, offset) => label(2, 2 + offset));
    expect(sectionsWithStatus("queued")).toEqual(window);
    expect(enqueuedSections()).toEqual(window);
    expect(enqueued.every((task) => task.priority === PIPELINE.LOOKAHEAD_PRIORITY)).toBe(true);
    expect(statusOf(2, 1)).toBe("pending");
    expect(statusOf(2, 2 + window.length)).toBe("pending");
    expect(sectionsWithStatus("pending")).toHaveLength(SECTION_COUNT - window.length);
    expect(sqlite.query<{ status: string }, []>("SELECT status FROM segments WHERE id = 'other-segment'").get()?.status).toBe("pending");
  });

  it("slides one section per step as the listener advances, across a chapter boundary, and never reaches back", async () => {
    const start = 2;
    await ensureLookahead(bookId, sectionAt(start));

    for (let anchor = start + 1; anchor <= start + SEGMENTS_PER_CHAPTER; anchor++) {
      const heard = sectionAt(anchor - 1);
      setStatus(heard.chapterIndex, heard.segmentIndex, "voiced");
      enqueued.length = 0;

      await ensureLookahead(bookId, sectionAt(anchor));

      expect(enqueuedSections()).toEqual(windowFrom(sectionAt(anchor + PIPELINE.LOOKAHEAD_SEGMENTS), 1));
      const beyond = sectionAt(anchor + WINDOW_SIZE);
      expect(statusOf(beyond.chapterIndex, beyond.segmentIndex)).toBe("pending");
    }
    expect(sectionAt(start + SEGMENTS_PER_CHAPTER).chapterIndex).toBe(2);
    expect(statusOf(1, 1)).toBe("pending");
    expect(statusOf(1, 2)).toBe("pending");
  });

  it("counts voiced and failed sections toward the window, so finished audio never moves it", async () => {
    const anchor = { chapterIndex: 1, segmentIndex: 2 };
    await ensureLookahead(bookId, anchor);
    sqlite.query("UPDATE segments SET status = 'voiced' WHERE status = 'queued'").run();
    setStatus(1, 3, "failed");
    enqueued.length = 0;

    for (let sync = 0; sync < 3; sync++) {
      passThrottle();
      await ensureLookahead(bookId, anchor);
    }

    expect(enqueued).toHaveLength(0);
    expect(sectionsWithStatus("pending")).toHaveLength(SECTION_COUNT - WINDOW_SIZE);
  });

  it("crosses into the next chapter with only the slots the window has left, skipping chapters without sections", async () => {
    const last = SEGMENTS_PER_CHAPTER;
    await ensureLookahead(bookId, { chapterIndex: 1, segmentIndex: last - 1 });
    const nextChapterSlots = PIPELINE.LOOKAHEAD_SEGMENTS - 1;
    expect(enqueuedSections()).toEqual([
      label(1, last - 1),
      label(1, last),
      ...Array.from({ length: nextChapterSlots }, (_, offset) => label(2, offset + 1)),
    ]);
    expect(statusOf(2, nextChapterSlots + 1)).toBe("pending");

    sqlite.query("DELETE FROM segments WHERE chapter_id = ?").run(chapterId(3));
    enqueued.length = 0;
    await ensureLookahead(bookId, { chapterIndex: 2, segmentIndex: last });
    expect(enqueuedSections()).toEqual([
      label(2, last),
      ...Array.from({ length: PIPELINE.LOOKAHEAD_SEGMENTS }, (_, offset) => label(4, offset + 1)),
    ]);
  });

  it("lifts sections already queued inside the window to the lookahead priority, and nothing outside it", async () => {
    setStatus(1, 2, "queued");
    setStatus(3, 1, "queued");

    await ensureLookahead(bookId, { chapterIndex: 1, segmentIndex: 1 });

    expect(lifted).toEqual([segmentId(1, 2)]);
    expect(enqueuedSections()).toEqual(windowFrom({ chapterIndex: 1, segmentIndex: 1 }).filter((section) => section !== label(1, 2)));
    expect(statusOf(3, 1)).toBe("queued");
  });

  it("skips a repeated anchor for a moment but never delays a moved one", async () => {
    await ensureLookahead(bookId, { chapterIndex: 1, segmentIndex: 1 });
    await ensureLookahead(bookId, { chapterIndex: 1, segmentIndex: 1 });
    expect(lifted).toHaveLength(0);

    enqueued.length = 0;
    await ensureLookahead(bookId, { chapterIndex: 1, segmentIndex: 2 });
    expect(enqueuedSections()).toEqual([label(1, WINDOW_SIZE + 1)]);

    lifted.length = 0;
    passThrottle();
    await ensureLookahead(bookId, { chapterIndex: 1, segmentIndex: 1 });
    expect(lifted).toHaveLength(WINDOW_SIZE);
  });

  it("returns promoted rows to pending when enqueueing fails and lets the same anchor retry at once", async () => {
    const anchor = { chapterIndex: 2, segmentIndex: 1 };
    rejectEnqueue = true;
    await expect(ensureLookahead(bookId, anchor)).rejects.toThrow("Queue unavailable");
    expect(sectionsWithStatus("queued")).toEqual([]);

    rejectEnqueue = false;
    await ensureLookahead(bookId, anchor);
    expect(sectionsWithStatus("queued")).toEqual(windowFrom(anchor));
  });

  it("ingestion primes a fresh book with its first section and the LOOKAHEAD_SEGMENTS after it, and voicing them opens nothing more", async () => {
    sqlite.exec("DELETE FROM segments; DELETE FROM chapters");
    sqlite.query("UPDATE books SET status = 'discovering' WHERE id = ?").run(bookId);

    await runIngestionJob({ data: { bookId, source: {} } } as Job<IngestionJobData>);

    expect(sqlite.query<{ status: string }, [string]>("SELECT status FROM books WHERE id = ?").get(bookId)?.status).toBe("in_progress");
    const primed = windowFrom({ chapterIndex: 1, segmentIndex: 1 });
    expect(enqueuedSections()).toEqual(primed);
    expect(sectionsWithStatus("queued")).toEqual(primed);
    expect(sectionsWithStatus("pending")).toHaveLength(SECTION_COUNT - primed.length);

    for (const data of [...enqueued]) {
      await runSegmentJob({ data, attemptsMade: 0 } as Job<SegmentJobData>);
    }
    await runPipelineSweep();

    expect(sectionsWithStatus("voiced")).toEqual(primed);
    expect(sectionsWithStatus("pending")).toHaveLength(SECTION_COUNT - primed.length);
  });

  it("sweep and boot recovery re-enqueue only rows that are already queued", async () => {
    setStatus(4, 3, "queued");

    await runPipelineSweep();
    await resumePendingWork();

    expect(enqueued.length).toBeGreaterThan(0);
    expect(new Set(enqueuedSections())).toEqual(new Set([label(4, 3)]));
    expect(sectionsWithStatus("pending")).toHaveLength(SECTION_COUNT - 1);
  });

  it("a stale job for a pending section cannot claim, retry, or requeue it", async () => {
    await runSegmentJob(job(3, 2));
    await runSegmentJob(job(3, 2, 1));
    await expect(reportSegmentFailure(job(3, 2), new Error("Stale job"))).rejects.toThrow("Stale job");

    expect(statusOf(3, 2)).toBe("pending");
    expect(enqueued).toHaveLength(0);
  });

  it("a lineage mismatch only resets a row it still holds", async () => {
    for (const racedStatus of ["pending", "voiced"]) {
      setStatus(3, 2, "queued");
      beforeQuery = (query) => {
        if (/^select\b[\s\S]* from "chapters"/.test(query)) setStatus(3, 2, racedStatus);
      };

      await runSegmentJob(job(3, 2, 0, { bookId: "another-book" }));

      expect(statusOf(3, 2)).toBe(racedStatus);
    }
    expect(enqueued).toHaveLength(0);
  });

  it("a retry or a permanent failure inside the window never opens a section beyond it", async () => {
    const anchor = { chapterIndex: 1, segmentIndex: 1 };
    await ensureLookahead(bookId, anchor);
    setStatus(1, WINDOW_SIZE, "processing");
    enqueued.length = 0;

    await expect(reportSegmentFailure(job(1, WINDOW_SIZE), new Error("TTS unavailable"))).rejects.toThrow("TTS unavailable");
    expect(statusOf(1, WINDOW_SIZE)).toBe("queued");
    await expect(
      reportSegmentFailure(job(1, WINDOW_SIZE, PIPELINE.MAX_SEGMENT_ATTEMPTS - 1), new Error("TTS unavailable")),
    ).rejects.toThrow("TTS unavailable");
    expect(statusOf(1, WINDOW_SIZE)).toBe("failed");

    await runPipelineSweep();
    passThrottle();
    await ensureLookahead(bookId, anchor);

    expect(statusOf(1, WINDOW_SIZE + 1)).toBe("pending");
    expect(enqueuedSections().every((section) => windowFrom(anchor).includes(section))).toBe(true);
  });

  it("orphan recovery leaves a row alone once it is no longer mid-flight", async () => {
    for (const racedStatus of ["pending", "voiced"]) {
      setStatus(3, 1, "processing");
      onGetJob = (id) => {
        if (id === segmentId(3, 1)) setStatus(3, 1, racedStatus);
      };

      await runPipelineSweep();

      expect(statusOf(3, 1)).toBe(racedStatus);
    }
    expect(enqueued).toHaveLength(0);
  });

  it("exposes ensureLookahead as the only way to open the window", () => {
    expect(Object.keys(lookahead)).toEqual(["ensureLookahead"]);
  });
});

interface Section {
  chapterIndex: number;
  segmentIndex: number;
}

function sqliteColumn(column: PgColumn): string {
  if (column.primary) return `"${column.name}" TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16))))`;
  const type = column.getSQLType() === "integer" ? "INTEGER" : "TEXT";
  if (!column.notNull || (typeof column.default !== "number" && typeof column.default !== "string")) return `"${column.name}" ${type}`;
  // Postgres's DEFAULT keyword reaches SQLite as NULL; REPLACE turns that NULL back into the column default.
  const fallback = typeof column.default === "string" ? `'${column.default}'` : column.default;
  return `"${column.name}" ${type} NOT NULL ON CONFLICT REPLACE DEFAULT ${fallback}`;
}

function toSqliteDialect(query: string): string {
  return query
    .replace(/\$\d+/g, "?")
    .replace(/::int\b/g, "")
    .replace(/\bUPDATE (\w+) (\w+)\s+SET\b/g, "UPDATE $1 AS $2 SET")
    .replace(/\(default,/g, "(lower(hex(randomblob(16))),")
    .replace(/\bdefault\b/g, "NULL");
}

function passThrottle(): void {
  clock += PAST_THROTTLE_MS;
  setSystemTime(new Date(clock));
}

function chapterId(chapterIndex: number): string {
  return `${bookId}-chapter-${chapterIndex}`;
}

function segmentId(chapterIndex: number, segmentIndex: number): string {
  return `${chapterId(chapterIndex)}-segment-${segmentIndex}`;
}

function label(chapterIndex: number, segmentIndex: number): string {
  return `${chapterIndex}:${segmentIndex}`;
}

function sectionAt(position: number): Section {
  return { chapterIndex: Math.floor(position / SEGMENTS_PER_CHAPTER) + 1, segmentIndex: (position % SEGMENTS_PER_CHAPTER) + 1 };
}

function windowFrom(anchor: Section, size = WINDOW_SIZE): string[] {
  const first = (anchor.chapterIndex - 1) * SEGMENTS_PER_CHAPTER + anchor.segmentIndex - 1;
  const end = Math.min(first + size, SECTION_COUNT);
  return Array.from({ length: end - first }, (_, offset) => {
    const section = sectionAt(first + offset);
    return label(section.chapterIndex, section.segmentIndex);
  });
}

function sectionsWithStatus(status: string): string[] {
  return sqlite
    .query<Section, [string, string]>(
      `SELECT c.chapter_index AS chapterIndex, s.segment_index AS segmentIndex
       FROM segments s JOIN chapters c ON c.id = s.chapter_id
       WHERE c.book_id = ? AND s.status = ?
       ORDER BY c.chapter_index, s.segment_index`,
    )
    .all(bookId, status)
    .map((row) => label(row.chapterIndex, row.segmentIndex));
}

function enqueuedSections(): string[] {
  return enqueued.map((task) => label(task.chapterIndex, task.segmentIndex));
}

function statusOf(chapterIndex: number, segmentIndex: number): string | undefined {
  return sqlite.query<{ status: string }, [string]>("SELECT status FROM segments WHERE id = ?").get(segmentId(chapterIndex, segmentIndex))
    ?.status;
}

function setStatus(chapterIndex: number, segmentIndex: number, status: string): void {
  sqlite.query("UPDATE segments SET status = ? WHERE id = ?").run(status, segmentId(chapterIndex, segmentIndex));
}

function job(chapterIndex: number, segmentIndex: number, attemptsMade = 0, data: Partial<SegmentJobData> = {}): Job<SegmentJobData> {
  return {
    data: {
      bookId,
      chapterId: chapterId(chapterIndex),
      chapterIndex,
      segmentId: segmentId(chapterIndex, segmentIndex),
      segmentIndex,
      ...data,
    },
    attemptsMade,
  } as Job<SegmentJobData>;
}
