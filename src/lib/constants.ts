/**
 * This module is shared between the Bun server and the browser bundle.
 * Bare `process.env.X` access throws `ReferenceError: process is not defined`
 * in the browser — and because dev mode (Vite) evaluates every module eagerly
 * with no tree-shaking, it killed the whole SPA before first render. Always
 * read env vars through this guard.
 */
const env = (key: string): string | undefined =>
  typeof process !== "undefined" && process.env ? process.env[key] : undefined;

export const SEGMENT = {
  MIN_WORDS: 150,
  TARGET_WORDS: 200,
  MAX_WORDS: 250,
  /** Each chapter's first segment is kept this small so playback unlocks within seconds */
  LEAD_IN_WORDS: 70,
  DIALOGUE_KEEP_WORDS: 12,
  SHORT_DIALOGUE_WORDS: 8,
  /** Hard cap for a single TTS block when a sentence has no terminal punctuation */
  HARD_MAX_WORDS: 300,
} as const;

export const AUDIO = {
  STANDARD_GAP_MS: 350,
  SCENE_BREAK_GAP_MS: 700,
  CHAPTER_BITRATE: "128k",
  CHAPTER_CHANNELS: 2,
  SAMPLE_RATE: 24000,
} as const;

export const PIPELINE = {
  MAX_SEGMENT_ATTEMPTS: 5,
  /** Unlock progressive/"Listen Live" once this many leading segments are voiced */
  PARTIAL_READY_THRESHOLD: 1,
  /**
   * Just-in-time voicing window: only this many unvoiced segments at/after
   * the listener's position are ever scheduled (pending → queued + BullMQ
   * job). The window re-centers on every playback position sync, so seeking
   * ahead transcribes from there instead — a book the user abandons early
   * never pays for voicing its unread remainder. Overridable via
   * LOOKAHEAD_SEGMENTS env var.
   */
  LOOKAHEAD_SEGMENTS: Number(env("LOOKAHEAD_SEGMENTS")) || 4,
  /**
   * How many segments voice concurrently per book. The MiMo account accepts
   * parallel requests (3 concurrent calls finish in ~4s vs ~10s serialized),
   * so keeping this at 1 starved throughput and made "Listen Live" stall for
   * minutes between lines. Overridable via MAX_WORKERS_PER_BOOK env var for
   * free-tier quotas that must stay serialized.
   */
  MAX_WORKERS_PER_BOOK: Number(env("MAX_WORKERS_PER_BOOK")) || 3,
  MIN_BOOK_WORDS: 500,
  /** Delay before retrying a failed chapter stitch in the background */
  STITCH_RETRY_DELAY_MS: 60_000,
  /** Base backoff before re-queuing a failed segment (doubles per attempt) */
  SEGMENT_RETRY_BASE_MS: 5_000,
  /** Cap on segment re-queue backoff during API outages */
  SEGMENT_RETRY_MAX_MS: 120_000,
} as const;

export const TTS = {
  /** A failed synthesis must release the segment worker promptly for retry. */
  MAX_RETRIES: 3,
  INITIAL_RETRY_DELAY_MS: 3000,
  /** Bound one stalled upstream request; the pipeline will retry the segment. */
  REQUEST_TIMEOUT_MS: 45_000,
  /** Do not let an upstream Retry-After freeze all future synthesis indefinitely. */
  MAX_RETRY_AFTER_MS: 60_000,
  RATE_LIMIT_STATUS: 429,
} as const;

export const PLAYBACK = {
  POSITION_SYNC_INTERVAL_MS: 8000,
} as const;

/**
 * Durable pipeline queue (BullMQ/Redis). The pipeline no longer keeps work in
 * process memory: ingestion, segment voicing, and chapter stitching are Redis
 * jobs, so a crash loses nothing beyond what the DB status already records,
 * and multiple server instances can share the load.
 */
export const QUEUE = {
  REDIS_URL: env("REDIS_URL") ?? "redis://127.0.0.1:6379",
  /** Concurrent book ingestions (EPUB download + parse hold whole buffers in memory). */
  INGESTION_CONCURRENCY: Number(env("INGESTION_CONCURRENCY")) || 2,
  /** Concurrent chapter stitches (ffmpeg + bounded-parallel segment downloads). */
  STITCH_CONCURRENCY: Number(env("STITCH_CONCURRENCY")) || 2,
  /** Give up stitching a chapter after this many BullMQ attempts. */
  MAX_STITCH_ATTEMPTS: 5,
  /** How often the maintenance sweep looks for orphaned/stuck work. */
  SWEEP_INTERVAL_MS: 5 * 60_000,
  /** A book still "discovering" after this long had its ingestion die mid-flight. */
  INGESTION_STUCK_MS: 60 * 60_000,
  /** Re-materialize queued segment jobs from the DB only when the queue is
   *  below this depth (covers Redis data loss without re-adding every sweep). */
  QUEUED_REFILL_WATERMARK: 100,
  /** Redis pub/sub channel fanning pipeline progress events out to every instance. */
  EVENTS_CHANNEL: "narratea:pipeline-events",
  /** Redis pub/sub channel broadcasting voice-context cache invalidations. */
  VOICE_INVALIDATE_CHANNEL: "narratea:voice-context-invalidate",
} as const;

export const TEMP = {
  /** Prefixes of pipeline working directories created under os.tmpdir() */
  DIR_PREFIXES: ["seg_tts_", "seg_regen_", "stitch_"],
  /** Startup sweep only removes orphaned temp dirs older than this */
  SWEEP_AGE_MS: 60 * 60_000,
} as const;

export const TORRENT = {
  MAX_FILE_SIZE_BYTES: 200 * 1024 * 1024,
  POLL_INTERVAL_MS: 10_000,
  /** 60 polls x 10s = 10-minute window for uncached torrents */
  MAX_POLLS: 60,
} as const;

/**
 * Zip-bomb / resource-exhaustion guards for EPUB ingestion. The upload cap
 * (80MB) bounds the *compressed* archive; these bound what we decompress and
 * parse into memory. Chosen well above any legitimate book so real libraries
 * never trip them.
 */
export const EPUB_LIMITS = {
  /** Declared uncompressed size summed across ALL archive entries (incl. images). */
  MAX_TOTAL_DECOMPRESSED_BYTES: 1024 * 1024 * 1024, // 1 GB
  /** META-INF/container.xml */
  MAX_CONTAINER_BYTES: 5 * 1024 * 1024,
  /** The single OPF package document */
  MAX_OPF_BYTES: 25 * 1024 * 1024,
  /** One spine HTML file (a huge omnibus chapter is ~5-10MB) */
  MAX_SPINE_FILE_BYTES: 50 * 1024 * 1024,
  /** Cumulative HTML/text actually read from spine files */
  MAX_TOTAL_TEXT_BYTES: 256 * 1024 * 1024,
  /** Bound on chapters inserted into the DB from one book */
  MAX_CHAPTERS: 2000,
  /** Bound on segments a single chapter may produce (pathological EPUBs). */
  MAX_SEGMENTS_PER_CHAPTER: 5_000,
  /** Bound on segments across the entire book — caps the DB insert flood a
   *  malicious archive (many chapters × many tiny segments) could cause. */
  MAX_SEGMENTS_PER_BOOK: 100_000,
} as const;

export const DEFAULT_TEXT_MODEL = "gemini-3.5-flash-lite";

// Xiaomi MiMo TTS (OpenAI-compatible chat-completions speech synthesis)
export const MIMO_TS_BASE_URL = "https://api.xiaomimimo.com/v1";
export const DEFAULT_TS_MODEL = "mimo-v2.5-tts";
export const VOICEDESIGN_TS_MODEL = "mimo-v2.5-tts-voicedesign";
export const DEFAULT_NARRATOR_VOICE = "Mia";
