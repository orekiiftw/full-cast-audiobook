export type BookStatus = "discovering" | "casting" | "in_progress" | "ready" | "failed";
type ChapterStatus = "queued" | "processing" | "partial_ready" | "ready" | "failed";
type SegmentStatus = "pending" | "queued" | "processing" | "annotated" | "voiced" | "failed";

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

export interface ApiError {
  error: string;
}

export type AuthMode = "login" | "signup";

export interface AuthUser {
  id?: string;
  email: string;
  createdAt?: string;
}

export interface AuthResponse {
  user: AuthUser;
}
