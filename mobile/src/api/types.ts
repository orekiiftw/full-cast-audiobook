// Mirrors the server's contract (`src/types/api.ts` plus the routes in `src/api/routes`).
// Keep these in step with the API: they are the client's only description of the wire.

export type BookStatus = "discovering" | "casting" | "in_progress" | "ready" | "failed";
export type ChapterStatus = "queued" | "processing" | "partial_ready" | "ready" | "failed";
export type SegmentStatus = "pending" | "queued" | "processing" | "annotated" | "voiced" | "failed";

export interface Book {
  id: string;
  title: string;
  author: string;
  coverR2Key: string | null;
  sourceHash: string;
  epubR2Key: string | null;
  status: BookStatus;
  createdAt: string;
}

export interface CastMember {
  id: string;
  bookId: string;
  name: string;
  aliases: string[];
  importance: "main" | "minor";
  voiceBucket: string;
  ttsVoiceName: string;
  styleString: string;
  pronunciationNotes: string | null;
}

export interface PronunciationTerm {
  id: string;
  bookId: string;
  term: string;
  phoneticHint: string;
}

export interface Chapter {
  id: string;
  bookId: string;
  chapterIndex: number;
  title: string;
  status: ChapterStatus;
  audioR2Key: string | null;
  durationMs: number | null;
  totalCount: number;
  voicedCount: number;
  failedCount: number;
}

export interface Segment {
  id: string;
  chapterId: string;
  segmentIndex: number;
  rawText: string;
  status: SegmentStatus;
  audioUrl: string | null;
  durationMs: number | null;
}

export interface PlaybackState {
  id: string;
  bookId: string;
  chapterId: string;
  positionMs: number;
  updatedAt: string;
}

export interface BookDetailResponse {
  book: Book;
  cast: CastMember[];
  chapters: Chapter[];
  pronunciation: PronunciationTerm[];
  playbackState: PlaybackState | null;
  // The route attaches per-chapter line counters alongside the detail payload.
  segmentProgress?: Record<string, { total: number; done: number }>;
  canRetry?: boolean;
}

// `GET /api/chapters/:id/segments` answers `{ chapter, segments }`; the chapter is re-sent
// because voicing moves its counters while the player is open.
export interface ChapterSegmentsResponse {
  chapter: Chapter;
  segments: Segment[];
}

interface PipelineEventBase {
  bookId: string;
  timestamp: number;
}

interface StatusChangeEvent extends PipelineEventBase {
  type: "status_change";
  status: BookStatus;
  message?: string;
  error?: string;
}

export interface ChapterStatusEvent extends PipelineEventBase {
  type: "chapter_status";
  chapterId: string;
  status: ChapterStatus;
  chapterIndex?: number;
  message?: string;
  error?: string;
  audioR2Key?: string;
  durationMs?: number;
}

export interface SegmentReadyEvent extends PipelineEventBase {
  type: "segment_ready";
  chapterId: string;
  chapterIndex: number;
  segmentId: string;
  segmentIndex: number;
  audioR2Key: string;
  audioUrl: string;
  durationMs: number;
  done: number;
  total: number;
  voicedCount: number;
}

interface SegmentFailedEvent extends PipelineEventBase {
  type: "segment_failed";
  segmentId: string;
  chapterId: string;
  error: string;
}

interface QuotaExceededEvent extends PipelineEventBase {
  type: "quota_exceeded";
  message?: string;
}

interface ProgressLogEvent extends PipelineEventBase {
  type: "progress_log";
  message: string;
}

export type PipelineEvent =
  StatusChangeEvent | ChapterStatusEvent | SegmentReadyEvent | SegmentFailedEvent | QuotaExceededEvent | ProgressLogEvent;

export interface AuthUser {
  id?: string;
  email: string;
}

export interface AuthSessionResponse {
  user: AuthUser;
  token: string;
  expiresAt: string;
}

export interface CurrentUserResponse {
  user: AuthUser;
}

export interface PlaybackSyncBody {
  bookId: string;
  chapterId: string;
  positionMs: number;
  segmentIndex: number;
}

export type BookFormat = "epub" | "pdf" | "mobi" | "azw3" | "unknown";

export interface SearchQuery {
  title?: string;
  author?: string;
  isbn?: string;
}

export interface BookMirror {
  id: string;
  label: string;
  url?: string;
  kind: "direct" | "torrent" | "ipfs" | "partner" | "unknown";
}

export interface BookResult {
  id: string;
  provider: string;
  title: string;
  subtitle?: string;
  authors: string[];
  language?: string;
  publisher?: string;
  year?: number;
  isbn?: string;
  format: BookFormat;
  filesize?: number;
  cover?: string;
  rating?: number;
  mirrors: BookMirror[];
  score?: number;
}

export interface BookSearchResponse {
  results: BookResult[];
  cache?: "hit" | "miss";
  providers?: string[];
  // The server answers inside a fixed budget: `partial` says at least one provider was still
  // searching, and `pending` names them. Results are never withheld because of a slow provider.
  partial?: boolean;
  pending?: string[];
}

// `POST /api/books` accepts JSON when there is no multipart body: title/author (or a
// magnet) plus an optional providerBook reference from a search result.
export interface BookSubmissionBody {
  title: string;
  author: string;
  magnet?: string;
  providerBook?: { provider: string; id: string; title: string; authors: string[]; format: BookFormat };
}

export interface MediaTokensResponse {
  urls: Record<string, string>;
  expiresAt: string;
}

export interface ApiErrorBody {
  error?: string;
  book?: Book;
}
