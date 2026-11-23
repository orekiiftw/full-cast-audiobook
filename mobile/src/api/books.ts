import { apiJson } from "./client";
import type {
  Book,
  BookDetailResponse,
  BookSearchResponse,
  BookSubmissionBody,
  ChapterSegmentsResponse,
  PlaybackSyncBody,
  SearchQuery,
} from "./types";

export function listBooks(): Promise<Book[]> {
  return apiJson<Book[]>("/api/books");
}

export function getBookDetail(bookId: string): Promise<BookDetailResponse> {
  return apiJson<BookDetailResponse>(`/api/books/${encodeURIComponent(bookId)}`);
}

export function deleteBook(bookId: string): Promise<{ success?: boolean }> {
  return apiJson<{ success?: boolean }>(`/api/books/${encodeURIComponent(bookId)}`, { method: "DELETE" });
}

export function retryBook(bookId: string): Promise<Book> {
  return apiJson<Book>(`/api/books/${encodeURIComponent(bookId)}/retry`, { method: "POST" });
}

// `at` re-centres the server's voicing lookahead on that line and is sent only while the
// player is stalled waiting for the next one.
export function getChapterSegments(chapterId: string, atSegmentIndex?: number): Promise<ChapterSegmentsResponse> {
  const query = atSegmentIndex === undefined ? "" : `?at=${atSegmentIndex}`;
  return apiJson<ChapterSegmentsResponse>(`/api/chapters/${encodeURIComponent(chapterId)}/segments${query}`);
}

export function putPlayback(body: PlaybackSyncBody, notifyOnUnauthorized = true): Promise<{ success?: boolean }> {
  return apiJson<{ success?: boolean }>("/api/playback", { method: "PUT", body, notifyOnUnauthorized });
}

export function searchBooks(query: SearchQuery): Promise<BookSearchResponse> {
  return apiJson<BookSearchResponse>("/api/book-search", { method: "POST", body: query });
}

export function submitBook(body: BookSubmissionBody): Promise<Book> {
  return apiJson<Book>("/api/books", { method: "POST", body });
}
