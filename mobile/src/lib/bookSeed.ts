import type { Book } from "@/api/types";

// `GET /api/books/:id` is 1.2–1.3s warm and 4.1s cold for a 77-chapter book. The library row
// that was tapped already holds everything the detail screen shows above the chapter list, so
// the row is parked here and the detail screen paints from it on the first frame instead of a
// skeleton of nothing. It is a cache of what we last saw, never a source of truth: the fetch
// that follows reconciles it, and a stale row is dropped after a few minutes.

export const BOOK_SEED_TTL_MS = 5 * 60_000;

const seeds = new Map<string, { book: Book; at: number }>();

export function rememberBookSeed(book: Book, now = Date.now()): void {
  if (!book?.id) return;
  seeds.set(book.id, { book, at: now });
}

export function rememberBookSeeds(books: Book[], now = Date.now()): void {
  for (const book of books) rememberBookSeed(book, now);
}

export function readBookSeed(bookId: string | undefined, now = Date.now()): Book | null {
  if (!bookId) return null;
  const entry = seeds.get(bookId);
  if (!entry) return null;
  if (now - entry.at > BOOK_SEED_TTL_MS) {
    seeds.delete(bookId);
    return null;
  }
  return entry.book;
}

export function forgetBookSeed(bookId: string): void {
  seeds.delete(bookId);
}

export function clearBookSeeds(): void {
  seeds.clear();
}
