import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { Job } from "bullmq";
import { books, castMembers, chapters, segments } from "../schema";
import { PIPELINE } from "../lib/constants";
import type { SegmentJobData, StitchJobData } from "../queue";
import { segmentAudioKey } from "../storage/keys";
import { createPipelineDatabase } from "./testSupport";

const BOOK_ID = "book-1";
const CHAPTER_ID = "chapter-1";
const SEGMENT_ID = "segment-1";
const STITCH = { bookId: BOOK_ID, chapterId: CHAPTER_ID, chapterIndex: 1 };

const { sqlite, db: testDb } = createPipelineDatabase([books, castMembers, chapters, segments]);
mock.module("../db", () => ({ db: testDb }));

const uploads: string[] = [];
const requeued: string[] = [];
const stitches: StitchJobData[] = [];
// The state the sweep finds the dead execution's job in; undefined means BullMQ has already removed the job.
let deadJobState: string | undefined;

mock.module("../queue", () => ({
  acquireLock: async () => "lock-token",
  releaseLock: async () => {},
  isLockHeld: async () => false,
  emitProgressEvent: () => {},
  enqueueSegmentJobs: async (tasks: SegmentJobData[]) => {
    requeued.push(...tasks.map((task) => task.segmentId));
  },
  enqueueStitch: async (task: StitchJobData) => {
    stitches.push(task);
  },
  enqueueIngestion: async () => {},
  removeBookJobs: async () => {},
  invalidateBookVoiceContextClusterwide: () => {},
  ingestJobId: (bookId: string) => bookId,
  segmentJobId: (segmentId: string) => segmentId,
  segmentQueue: {
    getJob: async () => (deadJobState === undefined ? undefined : { getState: async () => deadJobState, remove: async () => {} }),
    getJobCounts: async () => ({ wait: 0, active: 0, delayed: 0, prioritized: 0 }),
  },
  ingestionQueue: { getJob: async () => undefined },
  stitchQueue: {},
}));
mock.module("../narration/voiceContext", () => ({
  getBookVoiceContext: async () => ({ narratorId: null, narratorVoice: "Mia", narratorBaseStyle: "", pDict: {} }),
}));
mock.module("../narration/voiceSegment", () => ({
  synthesizeSegmentAudio: async () => ({ wav: Buffer.from([1]), durationMs: 1000 }),
}));
mock.module("../storage/r2", () => ({
  uploadFile: async (key: string) => {
    uploads.push(key);
  },
  deleteFiles: async () => 0,
}));
mock.module("./segment/annotation", () => ({ loadSegmentBeats: async () => [] }));

const { runPipelineSweep } = await import("./sweep");
const { runSegmentJob } = await import("./segment");

beforeEach(() => {
  sqlite.exec("DELETE FROM segments; DELETE FROM chapters; DELETE FROM books");
  sqlite.query("INSERT INTO books (id, status) VALUES (?, 'in_progress')").run(BOOK_ID);
  sqlite
    .query("INSERT INTO chapters (id, book_id, chapter_index, status, total_count) VALUES (?, ?, 1, 'processing', 1)")
    .run(CHAPTER_ID, BOOK_ID);
  // The execution that died had claimed the segment, and nothing released that claim.
  sqlite
    .query("INSERT INTO segments (id, chapter_id, segment_index, status, raw_text) VALUES (?, ?, 1, 'processing', 'Hello')")
    .run(SEGMENT_ID, CHAPTER_ID);
  uploads.length = 0;
  requeued.length = 0;
  stitches.length = 0;
  deadJobState = undefined;
});

describe("re-running a stalled segment job", () => {
  it("takes back the claim its dead execution left on the segment and voices it", async () => {
    await runSegmentJob(segmentJob({ attemptsMade: 0, attemptsStarted: 2 }));

    expect(segment()).toEqual({ status: "voiced", attempts: 0 });
    expect(uploads).toEqual([segmentAudioKey(BOOK_ID, 1, 1)]);
    expect(chapter()).toEqual({ voicedCount: 1, failedCount: 0 });
    expect(stitches).toEqual([STITCH]);
  });

  it("leaves a segment another execution has claimed alone on a job's first run", async () => {
    await runSegmentJob(segmentJob({ attemptsMade: 0, attemptsStarted: 1 }));

    expect(segment()).toEqual({ status: "processing", attempts: 0 });
    expect(uploads).toEqual([]);
  });
});

describe("sweeping a segment whose execution died", () => {
  const endings: Array<[string, string | undefined]> = [
    ["completed and was removed", undefined],
    ["completed", "completed"],
    ["failed", "failed"],
  ];
  for (const [ending, state] of endings) {
    it(`counts an attempt for every requeue after its job ${ending}, and fails the segment at the attempt limit`, async () => {
      deadJobState = state;
      for (let attempts = 1; attempts < PIPELINE.MAX_SEGMENT_ATTEMPTS; attempts++) {
        requeued.length = 0;
        await runPipelineSweep();
        expect(segment()).toEqual({ status: "queued", attempts });
        expect(requeued).toContain(SEGMENT_ID);
        // The requeued job claims the segment, and its worker dies too.
        sqlite.query("UPDATE segments SET status = 'processing' WHERE id = ?").run(SEGMENT_ID);
      }

      await runPipelineSweep();

      expect(segment()).toEqual({ status: "failed", attempts: PIPELINE.MAX_SEGMENT_ATTEMPTS });
      expect(chapter()).toEqual({ voicedCount: 0, failedCount: 1 });
      expect(stitches).toContainEqual(STITCH);
    });
  }
});

function segmentJob(attempts: { attemptsMade: number; attemptsStarted: number }): Job<SegmentJobData> {
  return {
    data: { bookId: BOOK_ID, chapterId: CHAPTER_ID, chapterIndex: 1, segmentId: SEGMENT_ID, segmentIndex: 1 },
    ...attempts,
  } as Job<SegmentJobData>;
}

function segment(): { status: string; attempts: number } | null {
  return sqlite.query<{ status: string; attempts: number }, [string]>("SELECT status, attempts FROM segments WHERE id = ?").get(SEGMENT_ID);
}

function chapter(): { voicedCount: number; failedCount: number } | null {
  return sqlite
    .query<{ voicedCount: number; failedCount: number }, [string]>(
      "SELECT voiced_count AS voicedCount, failed_count AS failedCount FROM chapters WHERE id = ?",
    )
    .get(CHAPTER_ID);
}
