import { Queue } from "bullmq";
import type { BookResult } from "../acquisition";
import { redisOptions } from "./connection";

export interface IngestionJobData {
  bookId: string;
  source: {
    torrentQuery?: { title: string; author: string };
    magnetOrHash?: string;
    providerBook?: BookResult;
  };
}

export interface SegmentJobData {
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  segmentId: string;
  segmentIndex: number;
}

export interface StitchJobData {
  bookId: string;
  chapterId: string;
  chapterIndex: number;
}

const QUEUE_PREFIX = "narratea";

export const queueOptions = { connection: redisOptions, prefix: QUEUE_PREFIX };

export const ingestionQueue = new Queue<IngestionJobData>("ingestion", queueOptions);

export const segmentQueue = new Queue<SegmentJobData>("segments", queueOptions);

export const stitchQueue = new Queue<StitchJobData>("stitch", queueOptions);

export const maintenanceQueue = new Queue("maintenance", queueOptions);

export const ingestJobId = (bookId: string): string => bookId;

export const segmentJobId = (segmentId: string): string => segmentId;

export const stitchJobId = (chapterId: string): string => chapterId;

const JOB_REMOVAL_BATCH_SIZE = 128;

export async function removeBookJobs(bookId: string, segmentIds: string[], chapterIds: string[]): Promise<void> {
  await ingestionQueue.remove(ingestJobId(bookId)).catch(() => 0);
  const removals = [
    ...segmentIds.map((segmentId) => () => segmentQueue.remove(segmentJobId(segmentId))),
    ...chapterIds.map((chapterId) => () => stitchQueue.remove(stitchJobId(chapterId))),
  ];
  for (let start = 0; start < removals.length; start += JOB_REMOVAL_BATCH_SIZE) {
    const batch = removals.slice(start, start + JOB_REMOVAL_BATCH_SIZE);
    await Promise.allSettled(batch.map((remove) => remove()));
  }
}
