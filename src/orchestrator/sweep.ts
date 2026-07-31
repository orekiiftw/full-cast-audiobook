/**
 * Maintenance sweep (runs every QUEUE.SWEEP_INTERVAL_MS via the repeatable job):
 * self-healing pass over DB state that outlived its queue job.
 */
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { books, chapters, segments } from "../schema";
import { PIPELINE, QUEUE } from "../lib/constants";
import { emitProgressEvent, enqueueSegmentJobs, enqueueStitch, segmentJobId, segmentQueue } from "../queue";

/** Job states in which BullMQ owns the row's lifecycle — never touch these. */
const LIVE_JOB_STATES = new Set(["wait", "delayed", "prioritized", "active", "waiting-children"]);

/**
 * Queued segments of in-progress books awaiting (re)materialization as BullMQ
 * jobs — shared shape for the sweep's watermark refill and boot recovery
 * paging. Callers append their own orderBy/limit/offset ($dynamic()).
 */
export function queuedSegmentsQuery() {
  return db
    .select({
      segmentId: segments.id,
      chapterId: chapters.id,
      bookId: chapters.bookId,
      chapterIndex: chapters.chapterIndex,
      segmentIndex: segments.segmentIndex,
    })
    .from(segments)
    .innerJoin(chapters, eq(segments.chapterId, chapters.id))
    .innerJoin(books, eq(chapters.bookId, books.id))
    .where(and(eq(segments.status, "queued"), eq(books.status, "in_progress")))
    .$dynamic();
}

/**
 * Self-healing pass over DB state that outlived its queue job. Each check is
 * idempotent and safe to run on any instance at any time:
 * 1. Segments stuck processing/annotated whose job is gone (Redis data loss,
 *    stalled-out jobs) → requeue (or fail when attempts are exhausted).
 * 2. Queue depth near zero while the DB still has queued rows (Redis flush)
 *    → re-materialize segment jobs from the DB.
 * 3. Chapters that are counter-terminal but never stitched → enqueue stitch.
 * 4. Books stuck "discovering" beyond INGESTION_STUCK_MS → failed.
 */
export async function runPipelineSweep(): Promise<void> {
  // 1. Orphaned mid-flight segments. Bounded: normally this set is tiny
  //    (≤ live workers), so a per-row getJob is cheap.
  const midflight = await db
    .select({
      segmentId: segments.id,
      chapterId: chapters.id,
      bookId: chapters.bookId,
      chapterIndex: chapters.chapterIndex,
      segmentIndex: segments.segmentIndex,
      attempts: segments.attempts,
    })
    .from(segments)
    .innerJoin(chapters, eq(segments.chapterId, chapters.id))
    .where(inArray(segments.status, ["processing", "annotated"]))
    .limit(500);

  for (const row of midflight) {
    try {
      const job = await segmentQueue.getJob(segmentJobId(row.segmentId));
      const state = job ? await job.getState() : "unknown";
      if (LIVE_JOB_STATES.has(state)) continue; // BullMQ owns it (incl. stalled recovery)
      // The job is gone or terminally failed — the row is orphaned.
      if (job) await job.remove().catch(() => {});
      if (row.attempts >= PIPELINE.MAX_SEGMENT_ATTEMPTS) {
        const newlyFailed = await db
          .update(segments)
          .set({ status: "failed" })
          .where(and(eq(segments.id, row.segmentId), sql`${segments.status} != 'failed'`))
          .returning({ id: segments.id });
        if (newlyFailed.length > 0) {
          const counters = await db
            .update(chapters)
            .set({ failedCount: sql`${chapters.failedCount} + 1` })
            .where(eq(chapters.id, row.chapterId))
            .returning({
              voicedCount: chapters.voicedCount,
              failedCount: chapters.failedCount,
              totalCount: chapters.totalCount,
            })
            .then((r) => r[0]);
          if (counters && counters.totalCount > 0 && counters.voicedCount + counters.failedCount >= counters.totalCount) {
            await enqueueStitch({ bookId: row.bookId, chapterId: row.chapterId, chapterIndex: row.chapterIndex });
          }
        }
        console.warn(`🧹 Sweep marked orphaned segment ${row.segmentId} failed (job state: ${state}).`);
      } else {
        await db.update(segments).set({ status: "queued" }).where(eq(segments.id, row.segmentId));
        await enqueueSegmentJobs([row]);
        console.warn(`🧹 Sweep requeued orphaned segment ${row.segmentId} (job state: ${state}).`);
      }
    } catch (err) {
      console.error(`Sweep failed for segment ${row.segmentId}:`, err);
    }
  }

  // 2. Watermark refill: the queue should hold work whenever the DB does.
  const counts = await segmentQueue.getJobCounts("wait", "active", "delayed", "prioritized");
  const depth = counts.wait + counts.active + counts.delayed + counts.prioritized;
  if (depth < QUEUE.QUEUED_REFILL_WATERMARK) {
    const queuedRows = await queuedSegmentsQuery()
      .orderBy(asc(chapters.bookId), asc(chapters.chapterIndex), asc(segments.segmentIndex))
      .limit(2000);
    if (queuedRows.length > 0) {
      await enqueueSegmentJobs(queuedRows);
      console.log(`🧹 Sweep refilled ${queuedRows.length} queued segment job(s) (queue depth was ${depth}).`);
    }
  }

  // 3. Chapters that finished voicing but never stitched.
  const stitchCandidates = await db
    .select()
    .from(chapters)
    .where(inArray(chapters.status, ["processing", "partial_ready"]))
    .limit(500);
  for (const ch of stitchCandidates) {
    try {
      await enqueueStitch({ bookId: ch.bookId, chapterId: ch.id, chapterIndex: ch.chapterIndex });
    } catch (err) {
      console.error(`Failed to enqueue stitch for chapter ${ch.id} during sweep:`, err);
    }
  }

  // 4. Ingestions whose worker died before marking the book failed.
  const stuckBefore = new Date(Date.now() - QUEUE.INGESTION_STUCK_MS);
  const interrupted = await db
    .update(books)
    .set({ status: "failed" })
    .where(and(inArray(books.status, ["discovering", "casting"]), lt(books.createdAt, stuckBefore)))
    .returning({ id: books.id });
  for (const book of interrupted) {
    emitProgressEvent(book.id, "status_change", { status: "failed", error: "Ingestion was interrupted. Use Retry." });
  }
  if (interrupted.length > 0) {
    console.warn(`⚠️ Sweep marked ${interrupted.length} stuck ingestion(s) as failed.`);
  }
}
