import { and, asc, eq, gt, gte, inArray, or } from "drizzle-orm";
import { db } from "../db";
import { chapters, segments } from "../schema";
import { PIPELINE } from "../lib/constants";
import { enqueueSegmentJobs, segmentJobId, segmentQueue, type SegmentJobData } from "../queue";

const LOOKAHEAD_THROTTLE_MS = 2_000;

const MAX_THROTTLE_KEYS = 5_000;

const PRIORITY_LIFT_BATCH_SIZE = 64;

const lookaheadThrottle = createWindowThrottle(LOOKAHEAD_THROTTLE_MS);

interface LookaheadAnchor {
  chapterIndex: number;
  segmentIndex: number;
}

const BOOK_START: LookaheadAnchor = { chapterIndex: 1, segmentIndex: 1 };

export async function ensureLookahead(bookId: string, anchor: LookaheadAnchor = BOOK_START): Promise<void> {
  const throttleKey = `${bookId}:${anchor.chapterIndex}:${anchor.segmentIndex}`;
  if (!lookaheadThrottle.shouldEvaluate(throttleKey)) return;

  try {
    const windowRows = await loadLookaheadWindow(bookId, anchor);
    await liftJobPriorities(queuedIds(windowRows), PIPELINE.LOOKAHEAD_PRIORITY);
    await promotePendingSegments(windowRows, bookId);
  } catch (err) {
    lookaheadThrottle.release(throttleKey);
    throw err;
  }
}

interface LookaheadWindowRow {
  segmentId: string;
  chapterId: string;
  chapterIndex: number;
  segmentIndex: number;
  status: string;
}

// Voiced and failed rows still occupy window slots. Counting only unfinished rows would let the
// window creep forward each time a buffered section finished voicing, with the listener standing still.
function loadLookaheadWindow(bookId: string, anchor: LookaheadAnchor): Promise<LookaheadWindowRow[]> {
  return db
    .select({
      segmentId: segments.id,
      chapterId: chapters.id,
      chapterIndex: chapters.chapterIndex,
      segmentIndex: segments.segmentIndex,
      status: segments.status,
    })
    .from(segments)
    .innerJoin(chapters, eq(segments.chapterId, chapters.id))
    .where(
      and(
        eq(chapters.bookId, bookId),
        or(
          gt(chapters.chapterIndex, anchor.chapterIndex),
          and(eq(chapters.chapterIndex, anchor.chapterIndex), gte(segments.segmentIndex, anchor.segmentIndex)),
        ),
      ),
    )
    .orderBy(asc(chapters.chapterIndex), asc(segments.segmentIndex))
    .limit(PIPELINE.LOOKAHEAD_SEGMENTS + 1);
}

async function promotePendingSegments(windowRows: LookaheadWindowRow[], bookId: string): Promise<void> {
  const pendingIds = pendingSegmentIds(windowRows);
  if (pendingIds.length === 0) return;

  const promoted = await db
    .update(segments)
    .set({ status: "queued" })
    .where(and(inArray(segments.id, pendingIds), eq(segments.status, "pending")))
    .returning({ id: segments.id });
  if (promoted.length === 0) return;

  await enqueueFromWindow(windowRows, promoted, bookId);
}

function queuedIds(windowRows: LookaheadWindowRow[]): string[] {
  return windowRows.filter((row) => row.status === "queued").map((row) => row.segmentId);
}

function pendingSegmentIds(windowRows: LookaheadWindowRow[]): string[] {
  return windowRows.filter((row) => row.status === "pending").map((row) => row.segmentId);
}

interface WindowThrottle {
  shouldEvaluate(throttleKey: string): boolean;
  release(throttleKey: string): void;
}

function createWindowThrottle(throttleMs: number): WindowThrottle {
  const lastEvaluatedAt = new Map<string, number>();

  return {
    shouldEvaluate(throttleKey: string): boolean {
      const now = Date.now();
      if (now - (lastEvaluatedAt.get(throttleKey) ?? 0) < throttleMs) return false;
      lastEvaluatedAt.set(throttleKey, now);
      if (lastEvaluatedAt.size > MAX_THROTTLE_KEYS) lastEvaluatedAt.clear();
      return true;
    },
    release(throttleKey: string): void {
      lastEvaluatedAt.delete(throttleKey);
    },
  };
}

async function enqueueFromWindow(windowRows: LookaheadWindowRow[], promoted: Array<{ id: string }>, bookId: string): Promise<void> {
  const promotedIds = new Set(promoted.map((row) => row.id));
  const tasks: SegmentJobData[] = windowRows
    .filter((row) => promotedIds.has(row.segmentId))
    .map((row) => ({
      bookId,
      chapterId: row.chapterId,
      chapterIndex: row.chapterIndex,
      segmentId: row.segmentId,
      segmentIndex: row.segmentIndex,
    }));
  try {
    await enqueueSegmentJobs(tasks, PIPELINE.LOOKAHEAD_PRIORITY);
  } catch (err) {
    await db
      .update(segments)
      .set({ status: "pending" })
      .where(and(inArray(segments.id, [...promotedIds]), eq(segments.status, "queued")))
      .catch(() => {});
    throw err;
  }
}

async function liftJobPriorities(segmentIds: string[], priority: number): Promise<void> {
  for (let start = 0; start < segmentIds.length; start += PRIORITY_LIFT_BATCH_SIZE) {
    await Promise.allSettled(
      segmentIds.slice(start, start + PRIORITY_LIFT_BATCH_SIZE).map(async (segmentId) => {
        const job = await segmentQueue.getJob(segmentJobId(segmentId));
        if (job) await job.changePriority({ priority });
      }),
    );
  }
}
