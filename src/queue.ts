import { EventEmitter } from "events";
import { Queue, Worker, type Job, type JobsOptions, type RedisOptions } from "bullmq";
import { Redis } from "ioredis";
import { PIPELINE, QUEUE } from "./lib/constants";
import { invalidateBookVoiceContext } from "./lib/bookCache";
import type { BookResult } from "./acquisition";

/** Durable pipeline queue backed by BullMQ/Redis.
 *
 * Ingestion, segment voicing, and chapter stitching are Redis-backed jobs. A crash mid-flight is
 * recovered by BullMQ's stalled-job detection (~30s), the maintenance sweep (orphaned DB rows whose
 * job is gone), or the boot-time re-enqueue. jobIds are the bare entity UUIDs (one keyspace per queue;
 * BullMQ rejects custom ids containing ':') so re-enqueueing is idempotent — BullMQ dedupes on jobId
 * atomically in Redis, and terminal leftovers are cleared before re-add so a failed/completed record
 * can never block a legitimate retry (e.g. regen re-stitch).
 *
 * Postgres remains the system of record for pipeline STATE (segment/chapter status, counters);
 * BullMQ owns SCHEDULING (ordering, retries, backoff, distribution). The atomic segment claim in the
 * DB stays as the final guard against double execution. Progress events fan out over Redis pub/sub
 * so an SSE client on instance A sees work performed by instance B.
 *
 * Queue topology (one per job type so a long ingestion can't starve segment synthesis):
 * - narratea-ingestion   concurrency QUEUE.INGESTION_CONCURRENCY, no retries
 * - narratea-segments    concurrency PIPELINE.MAX_WORKERS_PER_BOOK, exponential backoff
 * - narratea-stitch      concurrency QUEUE.STITCH_CONCURRENCY, fixed backoff
 * - narratea-maintenance concurrency 1 (periodic sweep) */

// Job payloads

export interface IngestionJobData {
  bookId: string;
  source: {
    torrentQuery?: { title: string; author: string };
    magnetOrHash?: string;
    providerBook?: BookResult;
    // No epubBuffer: uploads are persisted to storage BEFORE the job is enqueued (books route), and
    // the worker loads them via the book's epubR2Key. Job payloads must stay small and JSON-serializable.
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

// Redis connections

function parseRedisUrl(url: string): RedisOptions {
  const parsed = new URL(url);
  const db = parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : 0;
  return {
    host: parsed.hostname || "127.0.0.1",
    port: Number(parsed.port) || 6379,
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    db: Number.isFinite(db) ? db : 0,
    ...(parsed.protocol === "rediss:" ? { tls: {} } : {}),
    // BullMQ requires this on connections it drives with blocking commands.
    maxRetriesPerRequest: null,
  };
}

const redisOptions = parseRedisUrl(QUEUE.REDIS_URL);

/** Command connection for pub/sub publishing and distributed locks. */
export const redis = new Redis(redisOptions);
/** Dedicated subscriber connection (a subscribed client can't issue commands). */
const redisSub = new Redis(redisOptions);

redis.on("error", (err) => console.warn("⚠️ Redis connection error:", err.message));
redisSub.on("error", (err) => console.warn("⚠️ Redis subscriber error:", err.message));

/** Fail fast at boot when Redis is unreachable, with an actionable message. */
export async function pingRedis(timeoutMs = 15_000): Promise<void> {
  const result = await Promise.race([
    redis.ping().then(() => "ok" as const),
    new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), timeoutMs)),
  ]);
  if (result === "timeout") {
    throw new Error(
      `Could not reach Redis at ${QUEUE.REDIS_URL} within ${timeoutMs}ms. ` +
        `The pipeline queue requires Redis — start one (e.g. "docker run -p 6379:6379 redis:7") ` +
        `or set REDIS_URL.`,
    );
  }
}

// Progress events: Redis pub/sub bridge → local EventEmitter for SSE routes

// Global SSE events emitter (fed by the Redis subscriber bridge). Must comfortably exceed
// (MAX_SSE_PER_USER × expected concurrent users); the per-user SSE cap in events.ts bounds growth.
export const pipelineEvents = new EventEmitter();
pipelineEvents.setMaxListeners(500);

/** Pushes an event to all listening SSE clients across EVERY instance. Fire-and-forget: events are
    ephemeral progress signals; the database remains the source of truth for state. */
export function emitProgressEvent(bookId: string, eventType: string, payload: Record<string, unknown>) {
  const event = { bookId, type: eventType, ...payload, timestamp: Date.now() };
  redis.publish(QUEUE.EVENTS_CHANNEL, JSON.stringify(event)).catch((err) => {
    console.warn("⚠️ Failed to publish pipeline event:", err.message);
  });
}

/** Invalidate a book's cached voice context (narrator + pronunciation) on this instance AND every
    other sharing this Redis. The lib/bookCache cache is process-local, but pronunciation edits /
    retries / deletes must reach segment workers on every instance — otherwise others keep voicing
    with the stale dictionary for the full cache TTL. */
export function invalidateBookVoiceContextClusterwide(bookId: string): void {
  invalidateBookVoiceContext(bookId); // local (works even if Redis is down)
  redis.publish(QUEUE.VOICE_INVALIDATE_CHANNEL, bookId).catch((err) => {
    console.warn("⚠️ Failed to publish voice-context invalidation:", err.message);
  });
}

export async function initEventBridge(): Promise<void> {
  redisSub.on("message", (channel: string, message: string) => {
    if (channel === QUEUE.VOICE_INVALIDATE_CHANNEL) {
      invalidateBookVoiceContext(message);
      return;
    }
    try {
      pipelineEvents.emit("progress", JSON.parse(message));
    } catch {
      // Malformed event payload — drop it (best-effort).
    }
  });
  await redisSub.subscribe(QUEUE.EVENTS_CHANNEL, QUEUE.VOICE_INVALIDATE_CHANNEL);
}

// Queues

const QUEUE_PREFIX = "narratea";

export const ingestionQueue = new Queue<IngestionJobData>("ingestion", {
  connection: redisOptions,
  prefix: QUEUE_PREFIX,
});
export const segmentQueue = new Queue<SegmentJobData>("segments", {
  connection: redisOptions,
  prefix: QUEUE_PREFIX,
});
export const stitchQueue = new Queue<StitchJobData>("stitch", {
  connection: redisOptions,
  prefix: QUEUE_PREFIX,
});
export const maintenanceQueue = new Queue("maintenance", {
  connection: redisOptions,
  prefix: QUEUE_PREFIX,
});

// Job ids are the bare entity UUIDs: each queue has its own keyspace, and BullMQ rejects custom ids
// containing ':' (unless legacy repeat-format).
export const ingestJobId = (bookId: string) => bookId;
export const segmentJobId = (segmentId: string) => segmentId;
export const stitchJobId = (chapterId: string) => chapterId;

/** BullMQ treats add(jobId=X) as a no-op when a job with that id already exists in ANY state —
    including failed/completed. A kept failed record would permanently block retries (regen re-stitch,
    sweep refill). Clear terminal leftovers first; live states (wait/delayed/active/…) stay and dedupe. */
async function clearTerminalJob(queue: Queue<any, any, string>, jobId: string): Promise<void> {
  const existing = await queue.getJob(jobId);
  if (!existing) return;
  const state = await existing.getState();
  if (state === "failed" || state === "completed") {
    await existing.remove().catch(() => {});
  }
}

/** Enqueue a book ingestion. Deterministic jobId dedupes double submissions atomically in Redis
    (replacing the old in-memory ingestingBookIds guard). removeOnFail: a failed ingestion is fully
    recorded in books.status; we also clear any leftover terminal record so retry is never blocked. */
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

const SEGMENT_JOB_OPTS = {
  attempts: PIPELINE.MAX_SEGMENT_ATTEMPTS,
  // 5s → 10s → 20s → 40s → 80s between attempts; under SEGMENT_RETRY_MAX_MS.
  backoff: { type: "exponential", delay: PIPELINE.SEGMENT_RETRY_BASE_MS },
  removeOnComplete: true,
  // Keep a short failed trail for ops; clearTerminalJob removes them before any intentional
  // re-enqueue (sweep refill / orphan recovery).
  removeOnFail: { count: 1000 },
} satisfies Partial<JobsOptions>;

/** Enqueue segment voicing jobs in bounded bulk batches. Priority is the chapter index (BullMQ
    processes lower numbers first), preserving strict chapter-wise ordering across the whole book. */
export async function enqueueSegmentJobs(tasks: SegmentJobData[]): Promise<void> {
  const CHUNK = 1000;
  for (let i = 0; i < tasks.length; i += CHUNK) {
    const chunk = tasks.slice(i, i + CHUNK);
    // Clear terminal leftovers so a failed job record can't shadow a queued DB row.
    await Promise.all(chunk.map((t) => clearTerminalJob(segmentQueue, segmentJobId(t.segmentId))));
    await segmentQueue.addBulk(
      chunk.map((t) => ({
        name: "voice",
        data: t,
        opts: {
          ...SEGMENT_JOB_OPTS,
          jobId: segmentJobId(t.segmentId),
          // chapterIndex is 1-based (epubService); priority 0 means "unprioritized" and would
          // jump ahead of every prioritized job.
          priority: t.chapterIndex,
        },
      })),
    );
  }
}

export async function enqueueStitch(data: StitchJobData): Promise<void> {
  const jobId = stitchJobId(data.chapterId);
  // Critical for regen re-stitch after a previous stitch exhausted attempts: without this, the kept
  // failed job makes add() a silent no-op forever.
  await clearTerminalJob(stitchQueue, jobId);
  await stitchQueue.add("stitch", data, {
    jobId,
    attempts: QUEUE.MAX_STITCH_ATTEMPTS,
    backoff: { type: "fixed", delay: PIPELINE.STITCH_RETRY_DELAY_MS },
    removeOnComplete: true,
    removeOnFail: { count: 100 },
  });
}

/** Remove a deleted book's queued/delayed jobs (active jobs can't be removed — they no-op against the
    cascaded rows). Uses the public per-job remove API in bounded parallel batches; storage purging
    already dominates delete time. */
export async function removeBookJobs(bookId: string, segmentIds: string[], chapterIds: string[]): Promise<void> {
  await ingestionQueue.remove(ingestJobId(bookId)).catch(() => 0);
  const removals = [
    ...segmentIds.map((id) => () => segmentQueue.remove(segmentJobId(id))),
    ...chapterIds.map((id) => () => stitchQueue.remove(stitchJobId(id))),
  ];
  const BATCH = 128;
  for (let i = 0; i < removals.length; i += BATCH) {
    await Promise.allSettled(removals.slice(i, i + BATCH).map((fn) => fn()));
  }
}

// Distributed lock (segment regeneration guard — replaces the per-process Set)

export async function acquireLock(name: string, ttlMs: number): Promise<string | null> {
  const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const result = await redis.set(`narratea:lock:${name}`, token, "PX", ttlMs, "NX");
  return result === "OK" ? token : null;
}

export async function releaseLock(name: string, token: string): Promise<void> {
  // Only release the lock we actually hold (it may have expired and been re-acquired by another instance).
  await redis
    .eval(
      `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
      1,
      `narratea:lock:${name}`,
      token,
    )
    .catch((err) => console.warn("⚠️ Failed to release lock:", err.message));
}

// Workers

export interface PipelineProcessors {
  ingest: (job: Job<IngestionJobData>) => Promise<void>;
  voice: (job: Job<SegmentJobData>) => Promise<void>;
  stitch: (job: Job<StitchJobData>) => Promise<void>;
  sweep: (job: Job) => Promise<void>;
}

const workers: Worker[] = [];

export function startWorkers(processors: PipelineProcessors): void {
  const makeWorker = <T>(queueName: string, fn: (job: Job<T>) => Promise<void>, concurrency: number) =>
    new Worker<T>(queueName, fn, {
      connection: redisOptions,
      prefix: QUEUE_PREFIX,
      concurrency,
    });

  workers.push(
    makeWorker("ingestion", processors.ingest, QUEUE.INGESTION_CONCURRENCY),
    makeWorker("segments", processors.voice, PIPELINE.MAX_WORKERS_PER_BOOK),
    makeWorker("stitch", processors.stitch, QUEUE.STITCH_CONCURRENCY),
    makeWorker("maintenance", processors.sweep, 1),
  );
  for (const w of workers) {
    w.on("error", (err) => console.error(`❌ Queue worker "${w.name}" error:`, err));
  }
}

/** Register the periodic maintenance sweep. The repeatable job is deduped Redis-side, so every
    instance may call this at boot — only one schedule exists, and whichever instance picks the job
    up runs the sweep. */
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

/** Graceful shutdown: stop fetching new jobs, let active jobs finish. */
export async function stopPipeline(): Promise<void> {
  await Promise.allSettled(workers.map((w) => w.close()));
  await Promise.allSettled([ingestionQueue.close(), segmentQueue.close(), stitchQueue.close(), maintenanceQueue.close()]);
  await Promise.allSettled([redis.quit(), redisSub.quit()]);
}
