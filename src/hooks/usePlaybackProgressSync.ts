import { useCallback, useEffect, type MutableRefObject } from "react";
import { apiFetch } from "../lib/api";
import { PLAYBACK } from "../lib/constants";

export interface PlaybackTarget {
  bookId: string;
  chapterId: string;
}

interface UsePlaybackProgressSyncOptions {
  targetRef: MutableRefObject<PlaybackTarget | null>;
  positionRef: MutableRefObject<number>;
  segmentIndexRef: MutableRefObject<number>;
  activeBookId: string | null;
  activeChapterId: string | null;
}

export function usePlaybackProgressSync({
  targetRef,
  positionRef,
  segmentIndexRef,
  activeBookId,
  activeChapterId,
}: UsePlaybackProgressSyncOptions) {
  const syncPosition = useCallback(() => {
    const target = targetRef.current;
    if (!target) return;

    void apiFetch("/api/playback", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookId: target.bookId,
        chapterId: target.chapterId,
        positionMs: positionRef.current,
        segmentIndex: segmentIndexRef.current,
      }),
    }).catch(console.error);
  }, [positionRef, segmentIndexRef, targetRef]);

  useEffect(() => {
    if (!activeBookId || !activeChapterId) return;

    const interval = setInterval(syncPosition, PLAYBACK.POSITION_SYNC_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      syncPosition();
    };
  }, [activeBookId, activeChapterId, syncPosition]);

  return syncPosition;
}
