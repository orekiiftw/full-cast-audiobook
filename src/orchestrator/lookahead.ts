/**
 * Just-in-time voicing window + playback prefetch: promote pending segments
 * to queued only around (and just ahead of) the listener, so skipped or
 * abandoned parts of a book are never voiced.
 */
import { and, asc, eq, gt, gte, inArray, or } from "drizzle-orm";
import { db } from "../db";
import { chapters, segments } from "../schema";
import { EPUB_LIMITS, PIPELINE } from "../lib/constants";
import { enqueueSegmentJobs, segmentJobId, segmentQueue, type SegmentJobData } from "../queue";

/** Per book+anchor throttle — playback syncs arrive every few seconds
 *  and buffering players poll the segments endpoint, but the window only
 *  advances as segments are voiced, so repeated evaluations within a couple
 *  of seconds are pure churn. Keyed by anchor chapter so a cross-chapter seek
 *  is never throttled by the previous chapter's recent evaluation. */
const lookaheadThrottle = new Map<string, number>();
const LOOKAHEAD_THROTTLE_MS = 2_000;

export interface LookaheadAnchor {
  chapterIndex: number;
  segmentIndex: number;
}

/**
 * Opening-window scheduling: promote the first PIPELINE.LOOKAHEAD_SEGMENTS
 * unvoiced segments at/after the anchor from "pending" to "queued" and give
 * each a BullMQ job. Used at ingestion to prime fast first-audio; everything
 * further out stays "pending" until the listener starts a chapter (see
 * ensureChapterLookahead). Idempotent: promotion is an atomic pending→queued
 * update and BullMQ dedupes on the segment-id jobId.
 */
export async function ensureLookahead(
  bookId: string,
  anchor: LookaheadAnchor = { chapterIndex: 1, segmentIndex: 1 },
  opts: { /** Skip the HTTP-poll throttle. */ force?: boolean } = {}
): Promise<void> {
  const throttleKey = `${bookId}:${anchor.chapterIndex}`;
  const now = Date.now();
  if (!opts.force && now - (lookaheadThrottle.get(throttleKey) ?? 0) < LOOKAHEAD_THROTTLE_MS) {
    return;
  }
  if (!opts.force) lookaheadThrottle.set(throttleKey, now);
  // Soft cap so a long-lived process doesn't accumulate stale keys.
  if (lookaheadThrottle.size > 5000) lookaheadThrottle.clear();

  // chapterIndex and segmentIndex are both 1-based (epubService/segmentService).
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
    .where(
      and(
        eq(chapters.bookId, bookId),
        inArray(segments.status, ["pending", "queued", "processing", "annotated"]),
        or(
          gt(chapters.chapterIndex, anchor.chapterIndex),
          and(eq(chapters.chapterIndex, anchor.chapterIndex), gte(segments.segmentIndex, anchor.segmentIndex))
        )
      )
    )
    .orderBy(asc(chapters.chapterIndex), asc(segments.segmentIndex))
    .limit(PIPELINE.LOOKAHEAD_SEGMENTS);

  const pendingIds = windowRows.filter((r) => r.status === "pending").map((r) => r.segmentId);
  if (pendingIds.length === 0) return;

  const promoted = await db
    .update(segments)
    .set({ status: "queued" })
    .where(and(inArray(segments.id, pendingIds), eq(segments.status, "pending")))
    .returning({ id: segments.id });
  if (promoted.length === 0) return;

  await enqueueFromWindow(windowRows, promoted, bookId);
}

/**
 * Chapter-scoped scheduling: promote EVERY pending segment in the current
 * chapter and the next chapter from "pending" to "queued". This is the
 * listener-driven trigger — called when the user starts (or polls while)
 * playing chapter N — so the whole chapter N voices without interruption and
 * chapter N+1 is fully voiced by the time the listener reaches it. Nothing
 * beyond N+1 is ever scheduled until the listener advances, capping TTS spend
 * at two chapters ahead instead of the whole book. Idempotent.
 */
export async function ensureChapterLookahead(
  bookId: string,
  chapterIndex: number,
  opts: { /** Skip the HTTP-poll throttle. */ force?: boolean } = {}
): Promise<void> {
  const throttleKey = `chapter:${bookId}:${chapterIndex}`;
  const now = Date.now();
  if (!opts.force && now - (lookaheadThrottle.get(throttleKey) ?? 0) < LOOKAHEAD_THROTTLE_MS) {
    return;
  }
  if (!opts.force) lookaheadThrottle.set(throttleKey, now);
  if (lookaheadThrottle.size > 5000) lookaheadThrottle.clear();

  // Promote all pending segments in chapterIndex and chapterIndex+1 (if it
  // exists). Ordered by chapter then segment so the current chapter's jobs
  // run first (BullMQ priority = chapterIndex, lower runs first).
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
    .where(
      and(
        eq(chapters.bookId, bookId),
        inArray(chapters.chapterIndex, [chapterIndex, chapterIndex + 1]),
        eq(segments.status, "pending")
      )
    )
    .orderBy(asc(chapters.chapterIndex), asc(segments.segmentIndex));

  if (windowRows.length === 0) return;

  const pendingIds = windowRows.map((r) => r.segmentId);
  const promoted = await db
    .update(segments)
    .set({ status: "queued" })
    .where(and(inArray(segments.id, pendingIds), eq(segments.status, "pending")))
    .returning({ id: segments.id });
  if (promoted.length === 0) return;

  await enqueueFromWindow(windowRows, promoted, bookId);
}

/**
 * Shared enqueue + rollback for the two promotion paths. `windowRows` is the
 * candidate set this call selected; `promoted` is the subset the atomic
 * pending→queued update actually flipped (concurrent calls may have claimed
 * some). Only promoted rows get a job; if enqueue fails, roll them back to
 * "pending" so the next call re-drives them instead of stranding them queued.
 */
async function enqueueFromWindow(
  windowRows: Array<{ segmentId: string; chapterId: string; chapterIndex: number; segmentIndex: number; status: string }>,
  promoted: Array<{ id: string }>,
  bookId: string
): Promise<void> {
  const promotedIds = new Set(promoted.map((r) => r.id));
  const tasks: SegmentJobData[] = windowRows
    .filter((r) => promotedIds.has(r.segmentId))
    .map((r) => ({
      bookId,
      chapterId: r.chapterId,
      chapterIndex: r.chapterIndex,
      segmentId: r.segmentId,
      segmentIndex: r.segmentIndex,
    }));
  try {
    await enqueueSegmentJobs(tasks);
  } catch (err) {
    await db
      .update(segments)
      .set({ status: "pending" })
      .where(and(inArray(segments.id, [...promotedIds]), eq(segments.status, "queued")))
      .catch(() => {});
    throw err;
  }
}

/** Per book+chapter throttle — the chapters endpoint (which triggers this) is
 *  polled by buffering players, but the prefetch decision only changes when
 *  segments transition, so repeated evaluations within a few seconds are pure
 *  churn. */
const prefetchThrottle = new Map<string, number>();
const PREFETCH_THROTTLE_MS = 10_000;

/**
 * Playback prefetch: once chapter N is fully voiced, lift chapter N+1's
 * queued jobs so the next listen starts sooner. Never steals from unfinished
 * earlier chapters (that caused vol/ch N+1 to synthesize while N still had
 * gaps). Priorities are chapterIndex (lower runs first), so the boost moves
 * N+1's jobs up to N's level — ties break FIFO, keeping N's stragglers ahead.
 */
export async function prefetchNextChapter(bookId: string, currentChapterIndex: number) {
  const throttleKey = `${bookId}:${currentChapterIndex}`;
  const now = Date.now();
  if (now - (prefetchThrottle.get(throttleKey) ?? 0) < PREFETCH_THROTTLE_MS) {
    return;
  }
  prefetchThrottle.set(throttleKey, now);
  // Soft cap so a long-lived process doesn't accumulate stale keys.
  if (prefetchThrottle.size > 5000) prefetchThrottle.clear();

  const nextChapterIndex = currentChapterIndex + 1;

  // Still working on the chapter the user is listening to — keep natural
  // chapterIndex order so remaining lines of N finish before N+1 starts.
  const currentIncomplete = await db
    .select({ id: segments.id })
    .from(segments)
    .innerJoin(chapters, eq(segments.chapterId, chapters.id))
    .where(
      and(
        eq(chapters.bookId, bookId),
        eq(chapters.chapterIndex, currentChapterIndex),
        inArray(segments.status, ["queued", "processing", "annotated"])
      )
    )
    .limit(1);
  if (currentIncomplete.length > 0) {
    return;
  }

  const nextQueued = await db
    .select({ id: segments.id })
    .from(segments)
    .innerJoin(chapters, eq(segments.chapterId, chapters.id))
    .where(
      and(
        eq(chapters.bookId, bookId),
        eq(chapters.chapterIndex, nextChapterIndex),
        eq(segments.status, "queued")
      )
    )
    .limit(EPUB_LIMITS.MAX_SEGMENTS_PER_CHAPTER);

  // Best-effort re-prioritization of waiting jobs; jobs already active or
  // completed (or lost to a flush, later refilled by the sweep) are skipped.
  const BATCH = 64;
  for (let i = 0; i < nextQueued.length; i += BATCH) {
    await Promise.allSettled(
      nextQueued.slice(i, i + BATCH).map(async ({ id }) => {
        const job = await segmentQueue.getJob(segmentJobId(id));
        if (job) await job.changePriority({ priority: currentChapterIndex });
      })
    );
  }
}
