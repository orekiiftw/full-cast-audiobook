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

/** Per book+anchor-chapter throttle — playback syncs arrive every few seconds
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
 * Just-in-time scheduling: promote the first PIPELINE.LOOKAHEAD_SEGMENTS
 * unvoiced segments at/after the anchor from "pending" to "queued" and give
 * each a BullMQ job. Everything further out stays "pending" — no job, no
 * TTS spend — until the window advances onto it.
 *
 * Drivers: ingestion (anchor = book start), segment completion (top-up so
 * the opening window cannot drain and freeze the book), PUT /api/playback
 * (listener position), GET /api/chapters/:id/segments?at= (buffering player),
 * and the maintenance sweep (drained in_progress books). Idempotent:
 * promotion is an atomic pending→queued update and BullMQ dedupes on the
 * segment-id jobId, so overlapping calls can never double-schedule.
 */
export async function ensureLookahead(
  bookId: string,
  anchor: LookaheadAnchor = { chapterIndex: 1, segmentIndex: 1 },
  opts: { /** Skip the HTTP-poll throttle (segment completion / sweep). */ force?: boolean } = {}
): Promise<void> {
  const throttleKey = `${bookId}:${anchor.chapterIndex}`;
  const now = Date.now();
  // Playback/segment polls arrive every 1–8s; coalescing them is pure win.
  // Completion-driven top-ups must not share that throttle or a burst of
  // finished segments leaves the window half-empty until the next poll.
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

  // Atomic claim of the scheduling decision: concurrent ensureLookahead calls
  // (playback sync + buffering poll) select the same pending rows, but only
  // rows this call actually flips get jobs enqueued by it.
  const promoted = await db
    .update(segments)
    .set({ status: "queued" })
    .where(and(inArray(segments.id, pendingIds), eq(segments.status, "pending")))
    .returning({ id: segments.id });
  if (promoted.length === 0) return;

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
    // The promotion committed but the enqueue failed — roll still-queued rows
    // back to "pending" so the next ensureLookahead re-drives them, instead of
    // stranding them "queued" with no job until the sweep's watermark refill.
    // Rows a worker already claimed (processing) are untouched.
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
