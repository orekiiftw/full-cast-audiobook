/**
 * Pipeline orchestration on top of the durable BullMQ queues (see queue.ts).
 *
 * State vs. scheduling split:
 * - Postgres owns pipeline STATE: segment/chapter/book status, terminal
 *   counters. The atomic segment claim (queued → processing) remains the
 *   final guard against double execution — BullMQ can re-deliver a job
 *   (stalled recovery), the DB claim cannot be fooled by it.
 * - Redis/BullMQ owns SCHEDULING: ordering (priority = chapterIndex), retries
 *   with durable backoff, distribution across instances, stalled recovery.
 *
 * Recovery layers (no in-memory state is required for correctness):
 * 1. BullMQ stalled-job detection re-runs jobs of a dead worker (~30-60s).
 * 2. The segment processor resets its own row on retry (attemptsMade > 0),
 *    covering the crash-between-claim-and-failure-handler window.
 * 3. The maintenance sweep (every QUEUE.SWEEP_INTERVAL_MS) requeues DB rows
 *    left mid-flight whose job no longer exists, refills the queue after
 *    Redis data loss, re-enqueues due stitches, and fails stuck ingestions.
 * 4. resumePendingWork() at boot repairs counters and re-enqueues all queued
 *    segments (jobId dedupe makes this idempotent).
 *
 * Responsibilities live in sibling modules: ingestion.ts, segment.ts,
 * stitch.ts, sweep.ts, recovery.ts, lifecycle.ts, lookahead.ts.
 */
import {
  initEventBridge,
  pingRedis,
  scheduleSweep,
  startWorkers,
} from "../queue";
import { runIngestionJob } from "./ingestion";
import { runSegmentJob } from "./segment";
import { runStitchJob } from "./stitch";
import { runPipelineSweep } from "./sweep";
import { resumePendingWork } from "./recovery";

// Re-exported so existing consumers (SSE route, segment route, book routes)
// keep their imports from this barrel.
export { pipelineEvents, emitProgressEvent, stopPipeline } from "../queue";
export { queueBookIngestion } from "./ingestion";
export { restitchChapterInBackground } from "./stitch";
export { runPipelineSweep } from "./sweep";
export { resumePendingWork } from "./recovery";
export { deleteBook, retryFailedBook } from "./lifecycle";
export { ensureLookahead, prefetchNextChapter, type LookaheadAnchor } from "./lookahead";

/**
 * Connect Redis, recover pending work, then start workers and the sweep.
 * Recovery runs BEFORE workers start so re-enqueued rows are ready to claim;
 * BullMQ's own stalled recovery covers jobs whose worker died mid-attempt.
 */
export async function startPipeline(): Promise<void> {
  await pingRedis();
  await initEventBridge();
  // Recovery needs the DB; a transiently unreachable database at boot must
  // not prevent the server from coming up — the periodic sweep re-runs the
  // same healing logic every QUEUE.SWEEP_INTERVAL_MS.
  try {
    await resumePendingWork();
  } catch (err) {
    console.error("❌ Boot recovery failed (the periodic sweep will retry it):", err);
  }
  startWorkers({
    ingest: runIngestionJob,
    voice: runSegmentJob,
    stitch: runStitchJob,
    sweep: async () => {
      try {
        await runPipelineSweep();
      } catch (err) {
        console.error("Pipeline sweep failed (will run again on schedule):", err);
      }
    },
  });
  await scheduleSweep();
  console.log("🧵 Durable pipeline workers started (BullMQ/Redis).");
}
