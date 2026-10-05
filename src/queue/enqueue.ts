import { Queue, type JobsOptions } from "bullmq";
import { PIPELINE, QUEUE } from "../lib/constants";
import { redis } from "./connection";
import { ingestionQueue, segmentQueue, stitchQueue, ingestJobId, segmentJobId, stitchJobId } from "./queues";
import type { IngestionJobData, SegmentJobData, StitchJobData } from "./queues";

const SEGMENT_JOB_OPTIONS = {
  attempts: PIPELINE.MAX_SEGMENT_ATTEMPTS,
  backoff: { type: "exponential", delay: PIPELINE.SEGMENT_RETRY_BASE_MS },
  removeOnComplete: true,
  removeOnFail: { count: 1000 },
} satisfies Partial<JobsOptions>;

const SEGMENT_JOB_CHUNK_SIZE = 1000;

const SEGMENT_JOB_CLEAR_BATCH_SIZE = 64;

const STITCH_PENDING_TTL_MS = 5 * 60_000;

const stitchPendingKey = (chapterId: string): string => `narratea:stitch-pending:${chapterId}`;

export async function enqueueIngestion(bookId: string, source: IngestionJobData["source"]): Promise<void> {
  const jobId = ingestJobId(bookId);
  await clearTerminalJob(ingestionQueue, jobId);
  await ingestionQueue.add(
    "ingest",
    { bookId, source },
    {
      jobId,
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}

export async function enqueueSegmentJobs(tasks: SegmentJobData[], priorityOverride?: number): Promise<void> {
  for (let start = 0; start < tasks.length; start += SEGMENT_JOB_CHUNK_SIZE) {
    const chunk = tasks.slice(start, start + SEGMENT_JOB_CHUNK_SIZE);
    for (let clearStart = 0; clearStart < chunk.length; clearStart += SEGMENT_JOB_CLEAR_BATCH_SIZE) {
      const clearBatch = chunk.slice(clearStart, clearStart + SEGMENT_JOB_CLEAR_BATCH_SIZE);
      await Promise.all(clearBatch.map((task) => clearTerminalJob(segmentQueue, segmentJobId(task.segmentId))));
    }
    await segmentQueue.addBulk(
      chunk.map((task) => ({
        name: "voice",
        data: task,
        opts: {
          ...SEGMENT_JOB_OPTIONS,
          jobId: segmentJobId(task.segmentId),
          priority: priorityOverride ?? task.chapterIndex,
        },
      })),
    );
  }
}

export async function enqueueStitch(data: StitchJobData): Promise<void> {
  const jobId = stitchJobId(data.chapterId);
  await clearTerminalJob(stitchQueue, jobId);
  await stitchQueue.add("stitch", data, {
    jobId,
    attempts: QUEUE.MAX_STITCH_ATTEMPTS,
    backoff: { type: "fixed", delay: PIPELINE.STITCH_RETRY_DELAY_MS },
    removeOnComplete: true,
    removeOnFail: { count: 100 },
  });
  await markStitchPending(data.chapterId);
}

export async function discardStitchPending(chapterId: string): Promise<void> {
  await redis.del(stitchPendingKey(chapterId)).catch((err) => console.warn("discardStitchPending failed:", (err as Error).message));
}

export async function consumeStitchPending(chapterId: string): Promise<boolean> {
  const removed = await redis.del(stitchPendingKey(chapterId)).catch((err) => {
    console.warn("consumeStitchPending failed:", (err as Error).message);
    return 0;
  });
  return removed === 1;
}

async function clearTerminalJob<DataType, ResultType, NameType extends string>(
  queue: Queue<DataType, ResultType, NameType>,
  jobId: string,
): Promise<void> {
  const existing = await queue.getJob(jobId);
  if (!existing) return;
  const state = await existing.getState();
  if (state === "failed" || state === "completed") {
    await existing.remove().catch(() => {});
  }
}

async function markStitchPending(chapterId: string): Promise<void> {
  await redis
    .set(stitchPendingKey(chapterId), "1", "PX", STITCH_PENDING_TTL_MS)
    .catch((err) => console.warn("markStitchPending failed:", (err as Error).message));
}
