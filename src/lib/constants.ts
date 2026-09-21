import { env } from "./env";

export const SEGMENT = {
  MIN_WORDS: 150,
  TARGET_WORDS: 200,
  MAX_WORDS: 250,
  LEAD_IN_WORDS: 70,
  DIALOGUE_KEEP_WORDS: 12,
  SHORT_DIALOGUE_WORDS: 8,
  HARD_MAX_WORDS: 300,
} as const;

export const AUDIO = {
  STANDARD_GAP_MS: 350,
  SCENE_BREAK_GAP_MS: 700,
  EDGE_SILENCE_KEEP_MS: 40,
  BEAT_GAP_MS: 350,
  BEAT_GAP_SOFT_MS: 100,
  SEGMENT_TAIL_PAUSE_MS: 350,
  CHAPTER_BITRATE: "128k",
  CHAPTER_CHANNELS: 2,
  SAMPLE_RATE: 24000,
} as const;

export const PIPELINE = {
  MAX_SEGMENT_ATTEMPTS: 5,
  PARTIAL_READY_THRESHOLD: 1,
  LOOKAHEAD_SEGMENTS: Number(env("LOOKAHEAD_SEGMENTS")) || 4,
  LOOKAHEAD_PRIORITY: 0,
  MAX_WORKERS_PER_BOOK: Number(env("MAX_WORKERS_PER_BOOK")) || 3,
  MIN_BOOK_WORDS: 500,
  STITCH_RETRY_DELAY_MS: 60_000,
  SEGMENT_RETRY_BASE_MS: 5_000,
  SEGMENT_RETRY_MAX_MS: 120_000,
} as const;

export const TTS = {
  MAX_RETRIES: 3,
  INITIAL_RETRY_DELAY_MS: 3000,
  REQUEST_TIMEOUT_MS: 45_000,
  MAX_RETRY_AFTER_MS: 60_000,
  RATE_LIMIT_STATUS: 429,
} as const;

export const PLAYBACK = {
  POSITION_SYNC_INTERVAL_MS: 8000,
} as const;

export const QUEUE = {
  REDIS_URL: env("REDIS_URL") ?? "redis://127.0.0.1:6379",
  INGESTION_CONCURRENCY: Number(env("INGESTION_CONCURRENCY")) || 2,
  STITCH_CONCURRENCY: Number(env("STITCH_CONCURRENCY")) || 2,
  MAX_STITCH_ATTEMPTS: 5,
  SWEEP_INTERVAL_MS: 5 * 60_000,
  INGESTION_STUCK_MS: 60 * 60_000,
  QUEUED_REFILL_WATERMARK: 100,
  EVENTS_CHANNEL: "narratea:pipeline-events",
  VOICE_INVALIDATE_CHANNEL: "narratea:voice-context-invalidate",
} as const;

export const TEMP = {
  DIR_PREFIXES: ["seg_tts_", "seg_regen_", "stitch_"],
  SWEEP_AGE_MS: 60 * 60_000,
} as const;

export const ACQUISITION = {
  MAX_PROVIDER_NAME_LENGTH: 64,
  MAX_PROVIDER_BOOK_ID_LENGTH: 4096,
} as const;

export const TORRENT = {
  MAX_FILE_SIZE_BYTES: 200 * 1024 * 1024,
  POLL_INTERVAL_MS: 10_000,
  MAX_POLLS: 60,
  MAX_POLLS_UNCACHED: 12,
} as const;

export const EPUB_LIMITS = {
  MAX_TOTAL_DECOMPRESSED_BYTES: 128 * 1024 * 1024,
  MAX_ENTRY_DECOMPRESSED_BYTES: 64 * 1024 * 1024,
  MAX_CONTAINER_BYTES: 5 * 1024 * 1024,
  MAX_OPF_BYTES: 25 * 1024 * 1024,
  MAX_SPINE_FILE_BYTES: 50 * 1024 * 1024,
  MAX_TOTAL_TEXT_BYTES: 256 * 1024 * 1024,
  MAX_CHAPTERS: 2000,
  MAX_SEGMENTS_PER_CHAPTER: 5_000,
  MAX_SEGMENTS_PER_BOOK: 100_000,
  PAGE_MAX_WORDS: 600,
  MIN_CHAPTER_WORDS: 2500,
} as const;

export const DEFAULT_TEXT_MODEL = "gemini-3.5-flash-lite";

export const MIMO_TS_BASE_URL = "https://api.xiaomimimo.com/v1";
export const DEFAULT_TS_MODEL = "mimo-v2.5-tts";
export const VOICEDESIGN_TS_MODEL = "mimo-v2.5-tts-voicedesign";
export const DEFAULT_NARRATOR_VOICE = "Mia";

export const SARVAM_TS_BASE_URL = "https://api.sarvam.ai";
export const DEFAULT_SARVAM_TS_MODEL = "bulbul:v3";
export const DEFAULT_SARVAM_TS_SPEAKER = "shruti";
export const SARVAM_TS_MAX_CHARS = 2500;
export const SARVAM_TS_SAMPLE_RATE = 24000;

export const SARVAM_SPEAKERS = new Set([
  "shubh",
  "aditya",
  "ritu",
  "priya",
  "neha",
  "rahul",
  "pooja",
  "rohan",
  "simran",
  "kavya",
  "amit",
  "dev",
  "ishita",
  "shreya",
  "ratan",
  "varun",
  "manan",
  "sumit",
  "roopa",
  "kabir",
  "aayan",
  "ashutosh",
  "advait",
  "anand",
  "tanya",
  "tarun",
  "sunny",
  "mani",
  "gokul",
  "vijay",
  "shruti",
  "suhani",
  "mohit",
  "kavitha",
  "rehan",
  "soham",
  "rupali",
]);
