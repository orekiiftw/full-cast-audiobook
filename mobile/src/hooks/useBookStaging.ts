import { useCallback, useEffect, useRef, useState } from "react";
import { getBookDetail, retryBook } from "@/api/books";
import { useBookEvents } from "@/hooks/useBookEvents";
import type { Book } from "@/api/types";
import { createStagingState, isSettled, mergeStagingSnapshot, reduceStagingEvent, type StagingState } from "@/lib/addStage";
import type { DetailData } from "@/playback/detailsData";

// The add sheet's narration. `POST /api/books` answers as soon as the row exists and the pipeline
// runs in the background, so the sheet subscribes to the same event stream the detail screen uses
// and polls the detail payload for chapter titles, counters and anything the stream missed.

export const STAGING_POLL_MS = 4000;

export interface BookStagingModel {
  staging: StagingState;
  book: Book | null;
  retrying: boolean;
  retry: () => Promise<void>;
}

export function useBookStaging(bookId: string | null, seedTitle: string | null = null): BookStagingModel {
  const [staging, setStaging] = useState<StagingState>(() => createStagingState({ title: seedTitle }));
  const [book, setBook] = useState<Book | null>(null);
  const [retrying, setRetrying] = useState(false);
  const stagingRef = useRef(staging);
  stagingRef.current = staging;

  const commit = useCallback((next: StagingState) => {
    stagingRef.current = next;
    setStaging(next);
  }, []);

  const refresh = useCallback(async () => {
    if (!bookId) return;
    try {
      const data = (await getBookDetail(bookId)) as DetailData;
      setBook(data.book);
      commit(
        mergeStagingSnapshot(stagingRef.current, {
          title: data.book.title,
          bookStatus: data.book.status,
          chapters: data.chapters,
          segmentProgress: data.segmentProgress,
        }),
      );
    } catch {
      // A failed poll is not a failed add: the stream may still be live and the next poll retries.
    }
  }, [bookId, commit]);

  useEffect(() => {
    stagingRef.current = createStagingState({ title: seedTitle });
    setStaging(stagingRef.current);
    setBook(null);
    if (!bookId) return;
    void refresh();
  }, [bookId, seedTitle, refresh]);

  // The book's one stream, shared with the detail screen and the player. A status change is the
  // one event that also moves the payload — chapters are inserted, counters reset on retry — so
  // the row is refetched once per transition.
  useBookEvents(
    bookId,
    (event) => {
      const next = reduceStagingEvent(stagingRef.current, event);
      if (next !== stagingRef.current) commit(next);
      if (event.type === "status_change") void refresh();
    },
    () => void refresh(),
  );

  // While the studio is working, the poll fills in chapter titles and counters the stream does
  // not carry. It stops the moment the book settles.
  useEffect(() => {
    if (!bookId) return;
    const poll = setInterval(() => {
      if (!isSettled(stagingRef.current)) void refresh();
    }, STAGING_POLL_MS);
    return () => clearInterval(poll);
  }, [bookId, refresh]);

  const retry = useCallback(async () => {
    if (!bookId || retrying) return;
    setRetrying(true);
    try {
      await retryBook(bookId);
      commit({
        ...createStagingState({ title: stagingRef.current.title, bookStatus: "discovering" }),
        log: stagingRef.current.log,
        nextLogId: stagingRef.current.nextLogId,
      });
      await refresh();
    } catch {
      commit({ ...stagingRef.current, bookStatus: "failed", error: "The retry was refused. Try again in a moment." });
    } finally {
      setRetrying(false);
    }
  }, [bookId, retrying, refresh, commit]);

  return { staging, book, retrying, retry };
}
