import type { Book } from "@/api/types";

// Same wording the web client shows after an add: a book that already opened plays now,
// anything else is queued for performance.
export function addBookToast(book: Book): string {
  const opened = book.status === "ready" || book.status === "in_progress" || book.status === "casting";
  return opened ? `Opened “${book.title}”.` : `Queued “${book.title || "book"}” for performance.`;
}
