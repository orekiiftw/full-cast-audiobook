import { useEffect, useRef } from "react";
import type { PipelineEvent } from "@/api/types";
import { bookPipeline } from "@/api/pipeline";

// Subscribes a screen to the shared per-book stream. The handler is held in a ref so a screen
// that re-renders on every event does not tear the connection down and re-establish it.
export function useBookEvents(bookId: string | null | undefined, onEvent: (event: PipelineEvent) => void, onReconnect?: () => void): void {
  const eventRef = useRef(onEvent);
  const reconnectRef = useRef(onReconnect);
  eventRef.current = onEvent;
  reconnectRef.current = onReconnect;

  useEffect(() => {
    if (!bookId) return;
    return bookPipeline.subscribe(
      bookId,
      (event) => eventRef.current(event),
      () => reconnectRef.current?.(),
    );
  }, [bookId]);
}
