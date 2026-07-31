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
}

export interface ChapterSegmentsResponse {
  chapter: Chapter;
  segments: Segment[];
}

export type PipelineEventType =
  | "status_change"
  | "chapter_status"
  | "segment_ready"
  | "segment_failed"
  | "quota_exceeded"
  | "progress_log";

export interface PipelineEvent {
  bookId: string;
  type: PipelineEventType;
  timestamp: number;
  [key: string]: unknown;
}

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

export interface AuthCredentials {
  email: string;
  password: string;
}
