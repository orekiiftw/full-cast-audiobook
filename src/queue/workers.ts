import { Worker, type Job } from "bullmq";
import { PIPELINE, QUEUE } from "../lib/constants";
import { redis, redisSub } from "./connection";
import { ingestionQueue, maintenanceQueue, queueOptions, segmentQueue, stitchQueue } from "./queues";
import type { IngestionJobData, SegmentJobData, StitchJobData } from "./queues";

export interface PipelineProcessors {
  ingest: (job: Job<IngestionJobData>) => Promise<void>;
  voice: (job: Job<SegmentJobData>) => Promise<void>;
  stitch: (job: Job<StitchJobData>) => Promise<void>;
  sweep: (job: Job) => Promise<void>;
}

const workers: Worker[] = [];

export function startWorkers(processors: PipelineProcessors): void {
  const makeWorker = <T>(queueName: string, fn: (job: Job<T>) => Promise<void>, concurrency: number) =>
    new Worker<T>(queueName, fn, { ...queueOptions, concurrency });

  workers.push(
    makeWorker("ingestion", processors.ingest, QUEUE.INGESTION_CONCURRENCY),
    makeWorker("segments", processors.voice, PIPELINE.MAX_WORKERS_PER_BOOK),
    makeWorker("stitch", processors.stitch, QUEUE.STITCH_CONCURRENCY),
    makeWorker("maintenance", processors.sweep, 1),
  );

  for (const worker of workers) {
    worker.on("error", (err) => console.error(`❌ Queue worker "${worker.name}" error:`, err));
  }
}

export async function scheduleSweep(): Promise<void> {
  await maintenanceQueue.add(
    "sweep",
    {},
    {
      repeat: { every: QUEUE.SWEEP_INTERVAL_MS },
      removeOnComplete: true,
      removeOnFail: { count: 10 },
    },
  );
}

export async function stopPipeline(): Promise<void> {
  await Promise.allSettled(workers.map((worker) => worker.close()));
  await Promise.allSettled([ingestionQueue.close(), segmentQueue.close(), stitchQueue.close(), maintenanceQueue.close()]);
  await Promise.allSettled([redis.quit(), redisSub.quit()]);
}
