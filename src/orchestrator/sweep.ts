import { and, asc, eq, inArray, lt, sql, gt } from "drizzle-orm";
import { db } from "../db";
import { books, chapters, segments } from "../schema";
import { PIPELINE, QUEUE } from "../lib/constants";
import {
  emitProgressEvent,
  enqueueSegmentJobs,
  enqueueStitch,
  ingestJobId,
  ingestionQueue,
  isLockHeld,
  segmentJobId,
  segmentQueue,
} from "../queue";
import { incrementFailedCount, shouldEnqueueStitch } from "./chapterCounters";

const LIVE_JOB_STATES = new Set(["wait", "delayed", "prioritized", "active", "waiting-children"]);

const ORPHANED_SEGMENT_LIMIT = 500;
const STRANDED_QUEUED_LIMIT = 200;
const REFILL_LIMIT = 2_000;
const STITCH_CANDIDATE_LIMIT = 500;
const STUCK_INGESTION_LIMIT = 200;

interface MidflightSegment {
  segmentId: string;
  chapterId: string;
  bookId: string;
  chapterIndex: number;
  segmentIndex: number;
  attempts: number;
}

export function queuedSegmentsQuery(afterSegmentId?: string) {
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
    .where(
      and(eq(segments.status, "queued"), eq(books.status, "in_progress"), afterSegmentId ? gt(segments.id, afterSegmentId) : undefined),
    )
    .$dynamic();
}

export async function runPipelineSweep(): Promise<void> {
  await requeueOrphanedMidflightSegments();
  await rematerializeStrandedQueuedSegments();
  await refillSegmentQueue();
  await enqueueCounterTerminalStitches();
  await failStuckIngestions();
}

async function requeueOrphanedMidflightSegments(): Promise<void> {
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
    .limit(ORPHANED_SEGMENT_LIMIT);

  for (const row of midflight) {
    try {
      await resolveOrphanedSegment(row);
    } catch (err) {
      console.error(`Sweep failed for segment ${row.segmentId}:`, err);
    }
  }
}

async function resolveOrphanedSegment(row: MidflightSegment): Promise<void> {
  if (await isLockHeld(`regen:${row.segmentId}`)) return;

  const job = await segmentQueue.getJob(segmentJobId(row.segmentId));
  const state = job ? await job.getState() : "unknown";
  if (LIVE_JOB_STATES.has(state)) return;

  if (job) await job.remove().catch(() => {});

  const effectiveAttempts = row.attempts + (state === "failed" ? 1 : 0);
  if (effectiveAttempts >= PIPELINE.MAX_SEGMENT_ATTEMPTS) {
    await failOrphanedSegment(row, state, effectiveAttempts);
    return;
  }

  await requeueOrphanedSegment(row, state, effectiveAttempts);
}

async function failOrphanedSegment(row: MidflightSegment, jobState: string, attempts: number): Promise<void> {
  const newlyFailed = await db
    .update(segments)
    .set({ status: "failed", attempts })
    .where(and(eq(segments.id, row.segmentId), sql`${segments.status} != 'failed'`))
    .returning({ id: segments.id });

  if (newlyFailed.length > 0) {
    const counters = await incrementFailedCount(row.chapterId);
    if (shouldEnqueueStitch(counters)) {
      await enqueueStitch({ bookId: row.bookId, chapterId: row.chapterId, chapterIndex: row.chapterIndex });
    }
  }

  console.warn(`🧹 Sweep marked orphaned segment ${row.segmentId} failed (job state: ${jobState}).`);
}

async function requeueOrphanedSegment(row: MidflightSegment, jobState: string, attempts: number): Promise<void> {
  await db.update(segments).set({ status: "queued", attempts }).where(eq(segments.id, row.segmentId));
  await enqueueSegmentJobs([row]);
  console.warn(`🧹 Sweep requeued orphaned segment ${row.segmentId} (job state: ${jobState}).`);
}

async function rematerializeStrandedQueuedSegments(): Promise<void> {
  await enqueueQueuedSegments(
    STRANDED_QUEUED_LIMIT,
    (count) => `🧹 Sweep re-materialized ${count} queued segment row(s) (deduped against live jobs).`,
  );
}

async function refillSegmentQueue(): Promise<void> {
  const counts = await segmentQueue.getJobCounts("wait", "active", "delayed", "prioritized");
  const depth = counts.wait + counts.active + counts.delayed + counts.prioritized;
  if (depth >= QUEUE.QUEUED_REFILL_WATERMARK) return;

  await enqueueQueuedSegments(REFILL_LIMIT, (count) => `🧹 Sweep refilled ${count} queued segment job(s) (queue depth was ${depth}).`);
}

async function enqueueQueuedSegments(limit: number, describe: (count: number) => string): Promise<void> {
  const queuedRows = await queuedSegmentsQuery()
    .orderBy(asc(chapters.bookId), asc(chapters.chapterIndex), asc(segments.segmentIndex))
    .limit(limit);
  if (queuedRows.length === 0) return;

  await enqueueSegmentJobs(queuedRows);
  console.log(describe(queuedRows.length));
}

async function enqueueCounterTerminalStitches(): Promise<void> {
  const stitchCandidates = await db
    .select()
    .from(chapters)
    .where(
      and(
        inArray(chapters.status, ["queued", "processing", "partial_ready"]),
        sql`${chapters.voicedCount} + ${chapters.failedCount} >= ${chapters.totalCount}`,
      ),
    )
    .limit(STITCH_CANDIDATE_LIMIT);

  for (const chapter of stitchCandidates) {
    try {
      await enqueueStitch({ bookId: chapter.bookId, chapterId: chapter.id, chapterIndex: chapter.chapterIndex });
    } catch (err) {
      console.error(`Failed to enqueue stitch for chapter ${chapter.id} during sweep:`, err);
    }
  }
}

async function failStuckIngestions(): Promise<void> {
  const stuckBefore = new Date(Date.now() - QUEUE.INGESTION_STUCK_MS);
  const stuckCandidates = await db
    .select({ id: books.id })
    .from(books)
    .where(and(inArray(books.status, ["discovering", "casting"]), lt(books.createdAt, stuckBefore)))
    .limit(STUCK_INGESTION_LIMIT);

  const interrupted: Array<{ id: string }> = [];
  for (const candidate of stuckCandidates) {
    try {
      const job = await ingestionQueue.getJob(ingestJobId(candidate.id));
      const state = job ? await job.getState() : "unknown";
      if (LIVE_JOB_STATES.has(state)) continue;

      const failedRows = await db
        .update(books)
        .set({ status: "failed" })
        .where(and(eq(books.id, candidate.id), inArray(books.status, ["discovering", "casting"])))
        .returning({ id: books.id });
      interrupted.push(...failedRows);
    } catch (err) {
      console.error(`Sweep failed for stuck-ingestion check of book ${candidate.id}:`, err);
    }
  }

  for (const book of interrupted) {
    emitProgressEvent(book.id, "status_change", { status: "failed", error: "Ingestion was interrupted. Use Retry." });
  }
  if (interrupted.length > 0) {
    console.warn(`⚠️ Sweep marked ${interrupted.length} stuck ingestion(s) as failed.`);
  }
}
