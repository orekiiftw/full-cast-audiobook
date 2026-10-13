import { beforeEach, describe, expect, it, jest, mock } from "bun:test";
import { books, castMembers, chapters, pronunciationDict, segments } from "../schema";
import type { IngestionJobData, SegmentJobData, StitchJobData } from "../queue";
import { segmentAudioKey } from "../storage/keys";
import { createPipelineDatabase } from "./testSupport";

const BOOK_ID = "book-1";
const EPUB_KEY = `books/${BOOK_ID}/original.epub`;
const RETRY_IN_PROGRESS = { ok: false, error: "A retry for this book is already in progress." };
const WRITER_POLL_MS = 5_000;
const WRITER_WAIT_MS = 15 * 60_000;

const BOOK_TABLES = [books, castMembers, pronunciationDict, chapters, segments];

const { sqlite, db: testDb, hooks } = createPipelineDatabase(BOOK_TABLES, { foreignKeys: true });
mock.module("../db", () => ({ db: testDb }));

interface RunningJob<Data> {
  id: string;
  data: Data;
  state: string;
  getState(): Promise<string>;
}

const effects: string[] = [];
const removedJobs: Array<{ bookId: string; segmentIds: string[]; chapterIds: string[] }> = [];
const ingestions: Array<{ bookId: string; source: IngestionJobData["source"] }> = [];
const purges: string[][] = [];
const locks = new Map<string, string>();
const running = {
  ingestion: [] as RunningJob<IngestionJobData>[],
  segments: [] as RunningJob<SegmentJobData>[],
  stitch: [] as RunningJob<StitchJobData>[],
};
let rejectIngestion = false;
let beforeIngestion: () => Promise<void> | void = () => {};
let purgeGate: Promise<void> | undefined;

mock.module("../queue", () => ({
  acquireLock: async (name: string) => {
    if (locks.has(name)) return null;
    locks.set(name, `token:${name}`);
    return locks.get(name);
  },
  releaseLock: async (name: string, token: string) => {
    if (locks.get(name) === token) locks.delete(name);
  },
  isLockHeld: async (name: string) => locks.has(name),
  removeBookJobs: async (bookId: string, segmentIds: string[], chapterIds: string[]) => {
    effects.push("remove jobs");
    removedJobs.push({ bookId, segmentIds: [...segmentIds].sort(), chapterIds: [...chapterIds].sort() });
  },
  enqueueIngestion: async (bookId: string, source: IngestionJobData["source"]) => {
    await beforeIngestion();
    if (rejectIngestion) throw new Error("Redis unavailable");
    effects.push("enqueue ingestion");
    ingestions.push({ bookId, source });
  },
  enqueueSegmentJobs: async () => {},
  enqueueStitch: async () => {},
  emitProgressEvent: () => {},
  invalidateBookVoiceContextClusterwide: () => {},
  ingestJobId: (bookId: string) => bookId,
  segmentJobId: (segmentId: string) => segmentId,
  ingestionQueue: {
    getActive: async () => running.ingestion,
    getJob: async (bookId: string) =>
      ingestions.some((ingestion) => ingestion.bookId === bookId) ? { getState: async () => "waiting" } : undefined,
  },
  segmentQueue: {
    getActive: async () => running.segments,
    getJob: async () => undefined,
    getJobCounts: async () => ({ wait: 0, active: 0, delayed: 0, prioritized: 0 }),
  },
  stitchQueue: { getActive: async () => running.stitch },
}));
mock.module("../storage/r2", () => ({
  deleteFiles: async (keys: string[]) => {
    if (keys.length === 0) return 0;
    effects.push("purge");
    purges.push([...keys]);
    if (purgeGate) await purgeGate;
    return 0;
  },
}));

const { deleteBook, retryFailedBook } = await import("./lifecycle");
const { runPipelineSweep } = await import("./sweep");

beforeEach(() => {
  sqlite.exec("DELETE FROM books");
  effects.length = 0;
  removedJobs.length = 0;
  ingestions.length = 0;
  purges.length = 0;
  locks.clear();
  running.ingestion.length = 0;
  running.segments.length = 0;
  running.stitch.length = 0;
  rejectIngestion = false;
  beforeIngestion = () => {};
  purgeGate = undefined;
  hooks.beforeQuery = recordWrite;
});

describe("retrying a failed book", () => {
  it("removes the failed run's jobs before resetting its rows, and purges its audio before queueing the new run", async () => {
    seedFailedBook();

    expect(await retryFailedBook(BOOK_ID)).toEqual({ ok: true });

    expect(removedJobs).toEqual([
      { bookId: BOOK_ID, segmentIds: [segmentId(1, 1), segmentId(1, 2), segmentId(2, 1)], chapterIds: [chapterId(1), chapterId(2)] },
    ]);
    expect(effects.indexOf("remove jobs")).toBeLessThan(effects.indexOf("update books"));
    expect(effects.indexOf("purge")).toBeGreaterThan(effects.indexOf("delete cast_members"));
    expect(effects.lastIndexOf("purge")).toBeLessThan(effects.indexOf("enqueue ingestion"));
    expect(purgedKeys()).toEqual(new Set([segmentKey(1, 1), segmentKey(1, 2), chapterKey(1), chapterKey(2)]));
    expect(ingestions).toEqual([{ bookId: BOOK_ID, source: {} }]);
  });

  it("keeps the user's pronunciation dictionary while clearing the failed run's chapters, segments, and cast", async () => {
    seedFailedBook();

    expect(await retryFailedBook(BOOK_ID)).toEqual({ ok: true });

    expect(bookStatus()).toBe("discovering");
    expect(rowCounts()).toEqual({ chapters: 0, segments: 0, cast_members: 0, pronunciation_dict: 1 });
  });

  it("resets the book in one transaction, so a failure part-way leaves it failed, intact, and retryable", async () => {
    seedFailedBook();
    hooks.beforeQuery = (query) => {
      recordWrite(query);
      if (query.startsWith('delete from "cast_members"')) throw new Error("connection reset");
    };

    await expect(retryFailedBook(BOOK_ID)).rejects.toThrow('delete from "cast_members"');

    expect(bookStatus()).toBe("failed");
    expect(rowCounts()).toEqual({ chapters: 2, segments: 3, cast_members: 1, pronunciation_dict: 1 });
    expect(purges).toEqual([]);
    expect(ingestions).toEqual([]);

    hooks.beforeQuery = recordWrite;
    expect(await retryFailedBook(BOOK_ID)).toEqual({ ok: true });
    expect(bookStatus()).toBe("discovering");
  });

  it("keeps the stuck-ingestion sweep off a book it has claimed but not yet queued", async () => {
    // Created long enough ago that the sweep treats a discovering book without a live ingestion job as stuck.
    seedFailedBook({ createdAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString() });
    let statusWhenSwept: string | undefined;
    beforeIngestion = async () => {
      statusWhenSwept = bookStatus();
      await runPipelineSweep();
    };

    expect(await retryFailedBook(BOOK_ID)).toEqual({ ok: true });

    expect(statusWhenSwept).toBe("discovering");
    expect(bookStatus()).toBe("discovering");
    expect(ingestions).toEqual([{ bookId: BOOK_ID, source: {} }]);
  });

  it("turns away a second retry while the first is still clearing the failed run", async () => {
    seedFailedBook();
    let releasePurge = () => {};
    purgeGate = new Promise((resolve) => (releasePurge = resolve));

    const first = retryFailedBook(BOOK_ID);
    await until(() => effects.includes("purge"));
    expect(await retryFailedBook(BOOK_ID)).toEqual(RETRY_IN_PROGRESS);

    releasePurge();
    expect(await first).toEqual({ ok: true });
    expect(removedJobs).toHaveLength(1);
    expect(ingestions).toEqual([{ bookId: BOOK_ID, source: {} }]);
  });

  it("puts the book back to failed, and frees it for another retry, when the new run cannot be queued", async () => {
    seedFailedBook();
    rejectIngestion = true;

    expect(await retryFailedBook(BOOK_ID)).toEqual({ ok: false, error: "Could not schedule the retry. Try again in a few seconds." });
    expect(bookStatus()).toBe("failed");

    rejectIngestion = false;
    expect(await retryFailedBook(BOOK_ID)).toEqual({ ok: true });
  });
});

describe("deleting a book", () => {
  it("removes its jobs before its rows, then purges every recorded file and every key its layout implies", async () => {
    seedBookInProgress();

    expect(await deleteBook(BOOK_ID)).toBe(true);

    expect(removedJobs).toEqual([
      {
        bookId: BOOK_ID,
        segmentIds: [segmentId(1, 1), segmentId(1, 2), segmentId(2, 1), segmentId(2, 2), segmentId(2, 3)],
        chapterIds: [chapterId(1), chapterId(2)],
      },
    ]);
    expect(effects.indexOf("remove jobs")).toBeLessThan(effects.indexOf("delete books"));
    expect(rowCounts()).toEqual({ chapters: 0, segments: 0, cast_members: 0, pronunciation_dict: 0 });
    const layout = [
      EPUB_KEY,
      chapterKey(1),
      chapterKey(2),
      segmentKey(1, 1),
      segmentKey(1, 2),
      segmentKey(2, 1),
      segmentKey(2, 2),
      segmentKey(2, 3),
    ];
    await until(() => purgedKeys().size >= layout.length);
    expect(purgedKeys()).toEqual(new Set(layout));
  });

  it("purges again what the book's still-running jobs write, once every one of them has finished", async () => {
    seedBookInProgress();
    const voicing = runningJob<SegmentJobData>(segmentId(2, 2), {
      bookId: BOOK_ID,
      chapterId: chapterId(2),
      chapterIndex: 2,
      segmentId: segmentId(2, 2),
      segmentIndex: 2,
    });
    const stitching = runningJob<StitchJobData>(chapterId(2), { bookId: BOOK_ID, chapterId: chapterId(2), chapterIndex: 2 });
    const otherBook = runningJob<SegmentJobData>("other-segment", {
      bookId: "other-book",
      chapterId: "other-chapter",
      chapterIndex: 1,
      segmentId: "other-segment",
      segmentIndex: 1,
    });
    running.segments.push(voicing, otherBook);
    running.stitch.push(stitching);

    await withFakeTimers(async () => {
      await deleteBook(BOOK_ID);
      await flush();
      const firstPass = purges.length;
      expect(purgedKeys().has(segmentKey(2, 2))).toBe(true);

      await advance(3 * WRITER_POLL_MS);
      voicing.state = "unknown";
      await advance(WRITER_POLL_MS);
      expect(purges).toHaveLength(firstPass);

      stitching.state = "delayed";
      await advance(WRITER_POLL_MS);
      expect(purges.slice(firstPass)).toEqual([[segmentKey(2, 2), chapterKey(2)]]);
    });
  });

  it("stops waiting on a job still running after 15 minutes and purges its output anyway", async () => {
    seedBookInProgress();
    running.segments.push(
      runningJob<SegmentJobData>(segmentId(2, 2), {
        bookId: BOOK_ID,
        chapterId: chapterId(2),
        chapterIndex: 2,
        segmentId: segmentId(2, 2),
        segmentIndex: 2,
      }),
    );

    await withFakeTimers(async () => {
      await deleteBook(BOOK_ID);
      await flush();
      const firstPass = purges.length;

      await advance(WRITER_WAIT_MS - WRITER_POLL_MS);
      expect(purges).toHaveLength(firstPass);

      await advance(WRITER_POLL_MS);
      expect(purges.slice(firstPass)).toEqual([[segmentKey(2, 2)]]);
    });
  });
});

function seedFailedBook({ createdAt = new Date().toISOString() } = {}): void {
  insertBook("failed", createdAt);
  // Chapter 1 failed when its stitch kept failing, so its voiced lines have audio; chapter 2 never voiced a line.
  insertChapter(1, "failed");
  insertSegment(1, 1, "voiced", segmentKey(1, 1));
  insertSegment(1, 2, "voiced", segmentKey(1, 2));
  insertChapter(2, "failed");
  insertSegment(2, 1, "failed");
}

function seedBookInProgress(): void {
  insertBook("in_progress", new Date().toISOString());
  insertChapter(1, "ready", chapterKey(1));
  insertSegment(1, 1, "voiced", segmentKey(1, 1));
  insertSegment(1, 2, "voiced", segmentKey(1, 2));
  insertChapter(2, "processing");
  insertSegment(2, 1, "voiced", segmentKey(2, 1));
  insertSegment(2, 2, "processing");
  insertSegment(2, 3, "pending");
}

function insertBook(status: string, createdAt: string): void {
  sqlite
    .query(
      `INSERT INTO books (id, user_id, title, author, source_hash, status, epub_r2_key, created_at)
       VALUES (?, 'user-1', 'The Title', 'An Author', 'source-hash', ?, ?, ?)`,
    )
    .run(BOOK_ID, status, EPUB_KEY, createdAt);
  sqlite
    .query(
      `INSERT INTO cast_members (id, book_id, name, aliases, importance, voice_bucket, tts_voice_name, style_string)
       VALUES ('narrator', ?, 'Narrator', '{}', 'main', 'female_adult', 'Mia', 'warm')`,
    )
    .run(BOOK_ID);
  sqlite
    .query("INSERT INTO pronunciation_dict (id, book_id, term, phonetic_hint) VALUES ('term', ?, 'Hermione', 'her-MY-oh-nee')")
    .run(BOOK_ID);
}

function insertChapter(chapterIndex: number, status: string, audioKey: string | null = null): void {
  sqlite
    .query("INSERT INTO chapters (id, book_id, chapter_index, title, status, audio_r2_key) VALUES (?, ?, ?, ?, ?, ?)")
    .run(chapterId(chapterIndex), BOOK_ID, chapterIndex, `Chapter ${chapterIndex}`, status, audioKey);
}

function insertSegment(chapterIndex: number, segmentIndex: number, status: string, audioKey: string | null = null): void {
  sqlite
    .query("INSERT INTO segments (id, chapter_id, segment_index, raw_text, status, audio_r2_key) VALUES (?, ?, ?, 'Text', ?, ?)")
    .run(segmentId(chapterIndex, segmentIndex), chapterId(chapterIndex), segmentIndex, status, audioKey);
}

function chapterId(chapterIndex: number): string {
  return `chapter-${chapterIndex}`;
}

function segmentId(chapterIndex: number, segmentIndex: number): string {
  return `segment-${chapterIndex}-${segmentIndex}`;
}

function chapterKey(chapterIndex: number): string {
  return `books/${BOOK_ID}/chapters/chapter_${chapterIndex}.mp3`;
}

function segmentKey(chapterIndex: number, segmentIndex: number): string {
  return segmentAudioKey(BOOK_ID, chapterIndex, segmentIndex);
}

function runningJob<Data>(id: string, data: Data): RunningJob<Data> {
  const job: RunningJob<Data> = { id, data, state: "active", getState: async () => job.state };
  return job;
}

function recordWrite(query: string): void {
  const write = /^(update|delete from) "(\w+)"/.exec(query);
  if (write) effects.push(`${write[1] === "update" ? "update" : "delete"} ${write[2]}`);
}

function bookStatus(): string | undefined {
  return sqlite.query<{ status: string }, [string]>("SELECT status FROM books WHERE id = ?").get(BOOK_ID)?.status;
}

function rowCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const table of ["chapters", "segments", "cast_members", "pronunciation_dict"]) {
    counts[table] = sqlite.query<{ total: number }, []>(`SELECT COUNT(*) AS total FROM ${table}`).get()?.total ?? 0;
  }
  return counts;
}

function purgedKeys(): Set<string> {
  return new Set(purges.flat());
}

async function until(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !condition(); attempt++) await Bun.sleep(1);
}

// The background purge only awaits mocks and its own poll timer, so draining microtasks lets it reach the next sleep.
async function flush(): Promise<void> {
  for (let tick = 0; tick < 100; tick++) await Promise.resolve();
}

async function advance(ms: number): Promise<void> {
  for (let elapsed = 0; elapsed < ms; elapsed += WRITER_POLL_MS) {
    jest.advanceTimersByTime(WRITER_POLL_MS);
    await flush();
  }
}

async function withFakeTimers(run: () => Promise<void>): Promise<void> {
  jest.useFakeTimers({ now: Date.now() });
  try {
    await run();
  } finally {
    jest.useRealTimers();
  }
}
