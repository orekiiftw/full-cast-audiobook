import { and, asc, eq, gt, gte, inArray, lte, or } from "drizzle-orm";
import { db } from "../db";
import { chapters, segments } from "../schema";
import { EPUB_LIMITS, PIPELINE } from "../lib/constants";
import { firstRow } from "../lib/query";
import { enqueueSegmentJobs, segmentJobId, segmentQueue, type SegmentJobData } from "../queue";

const LOOKAHEAD_THROTTLE_MS = 2_000;

const PREFETCH_THROTTLE_MS = 10_000;

const MAX_THROTTLE_KEYS = 5_000;

const PRIORITY_LIFT_BATCH_SIZE = 64;

const lookaheadThrottle = createWindowThrottle(LOOKAHEAD_THROTTLE_MS);

const prefetchThrottle = createWindowThrottle(PREFETCH_THROTTLE_MS);

interface LookaheadAnchor {
  chapterIndex: number;
  segmentIndex: number;
}

export async function ensureLookahead(
  bookId: string,
  anchor: LookaheadAnchor = { chapterIndex: 1, segmentIndex: 1 },
  opts: { force?: boolean } = {},
): Promise<void> {
  if (!lookaheadThrottle.shouldEvaluate(`${bookId}:${anchor.chapterIndex}`, opts)) return;

  const windowRows = await loadLookaheadWindow(bookId, anchor);
  await liftJobPriorities(queuedIds(windowRows), PIPELINE.LOOKAHEAD_PRIORITY);

  await promotePendingSegments(windowRows, bookId, PIPELINE.LOOKAHEAD_PRIORITY);
}

export async function ensureChapterLookahead(bookId: string, chapterIndex: number, opts: { force?: boolean } = {}): Promise<void> {
  const includeBuffer = lookaheadThrottle.shouldEvaluate(`chapter:${bookId}:${chapterIndex}`, opts);

  const windowRows = await db
    .select({
      segmentId: segments.id,
      chapterId: chapters.id,
      chapterIndex: chapters.chapterIndex,
      segmentIndex: segments.segmentIndex,
      status: segments.status,
    })
    .from(segments)
    .innerJoin(chapters, eq(segments.chapterId, chapters.id))
    .where(and(chapterWindow(bookId, chapterIndex, includeBuffer ? PIPELINE.CHAPTER_LOOKAHEAD : 0), eq(segments.status, "pending")))
    .orderBy(asc(chapters.chapterIndex), asc(segments.segmentIndex));

  await promotePendingSegments(windowRows, bookId);
}

export async function prefetchNextChapter(bookId: string, currentChapterIndex: number): Promise<void> {
  if (!prefetchThrottle.shouldEvaluate(`${bookId}:${currentChapterIndex}`)) return;

  const currentIncomplete = await firstRow(
    db
      .select({ id: segments.id })
      .from(segments)
      .innerJoin(chapters, eq(segments.chapterId, chapters.id))
      .where(
        and(
          eq(chapters.bookId, bookId),
          eq(chapters.chapterIndex, currentChapterIndex),
          inArray(segments.status, ["queued", "processing", "annotated"]),
        ),
      )
      .limit(1),
  );
  if (currentIncomplete) return;

  const nextQueued = await db
    .select({ id: segments.id })
    .from(segments)
    .innerJoin(chapters, eq(segments.chapterId, chapters.id))
    .where(and(eq(chapters.bookId, bookId), eq(chapters.chapterIndex, currentChapterIndex + 1), eq(segments.status, "queued")))
    .limit(EPUB_LIMITS.MAX_SEGMENTS_PER_CHAPTER);

  await liftJobPriorities(
    nextQueued.map((row) => row.id),
    currentChapterIndex,
  );
}

interface LookaheadWindowRow {
  segmentId: string;
  chapterId: string;
  chapterIndex: number;
  segmentIndex: number;
  status: string;
}

function chapterWindow(bookId: string, chapterIndex: number, lookahead = PIPELINE.CHAPTER_LOOKAHEAD) {
  return and(eq(chapters.bookId, bookId), gte(chapters.chapterIndex, chapterIndex), lte(chapters.chapterIndex, chapterIndex + lookahead));
}

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
        chapterWindow(bookId, anchor.chapterIndex),
        inArray(segments.status, ["pending", "queued", "processing", "annotated"]),
        or(
          gt(chapters.chapterIndex, anchor.chapterIndex),
          and(eq(chapters.chapterIndex, anchor.chapterIndex), gte(segments.segmentIndex, anchor.segmentIndex)),
        ),
      ),
    )
    .orderBy(asc(chapters.chapterIndex), asc(segments.segmentIndex))
    .limit(PIPELINE.LOOKAHEAD_SEGMENTS);
}

async function promotePendingSegments(windowRows: LookaheadWindowRow[], bookId: string, priority?: number): Promise<void> {
  const pendingIds = pendingSegmentIds(windowRows);
  if (pendingIds.length === 0) return;

  const promoted = await db
    .update(segments)
    .set({ status: "queued" })
    .where(and(inArray(segments.id, pendingIds), eq(segments.status, "pending")))
    .returning({ id: segments.id });
  if (promoted.length === 0) return;

  await enqueueFromWindow(windowRows, promoted, bookId, priority);
}

function queuedIds(windowRows: LookaheadWindowRow[]): string[] {
  return windowRows.filter((row) => row.status === "queued").map((row) => row.segmentId);
}

function pendingSegmentIds(windowRows: LookaheadWindowRow[]): string[] {
  return windowRows.filter((row) => row.status === "pending").map((row) => row.segmentId);
}

interface WindowThrottle {
  shouldEvaluate(throttleKey: string, opts?: { force?: boolean }): boolean;
}

function createWindowThrottle(throttleMs: number): WindowThrottle {
  const lastEvaluatedAt = new Map<string, number>();

  return {
    shouldEvaluate(throttleKey: string, opts: { force?: boolean } = {}): boolean {
      const now = Date.now();
      if (!opts.force && now - (lastEvaluatedAt.get(throttleKey) ?? 0) < throttleMs) return false;
      if (!opts.force) lastEvaluatedAt.set(throttleKey, now);
      if (lastEvaluatedAt.size > MAX_THROTTLE_KEYS) lastEvaluatedAt.clear();
      return true;
    },
  };
}

async function enqueueFromWindow(
  windowRows: LookaheadWindowRow[],
  promoted: Array<{ id: string }>,
  bookId: string,
  priority?: number,
): Promise<void> {
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
    await enqueueSegmentJobs(tasks, priority);
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
