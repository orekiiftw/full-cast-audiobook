import { useEffect } from "react";
import type { Segment } from "../../types/api";
import type { AudioTransport } from "./useAudioTransport";
import type { SegmentPlaybackRefs } from "./useSegmentSync";

const READY_RETRY_INTERVAL_MS = 800;

const READY_RETRY_LIMIT = 5;

interface UsePlaybackFollowOptions {
  isPlaying: boolean;
  isBufferingNext: boolean;
  refs: SegmentPlaybackRefs;
  audio: AudioTransport;
  setIsPlaying: (playing: boolean) => void;
  segmentsList: Segment[];
  currentSegmentIndex: number;
  prefetchNextSegment: (segments: Segment[], index: number) => void;
}

export function usePlaybackFollow({
  isPlaying,
  isBufferingNext,
  refs,
  audio,
  setIsPlaying,
  segmentsList,
  currentSegmentIndex,
  prefetchNextSegment,
}: UsePlaybackFollowOptions): void {
  useEffect(() => {
    if (!isPlaying) return;
    prefetchNextSegment(segmentsList, currentSegmentIndex);
  }, [isPlaying, currentSegmentIndex, segmentsList, prefetchNextSegment]);

  useEffect(() => {
    if (isPlaying && !isBufferingNext) {
      void audio.play();
    } else if (!isPlaying) {
      audio.pause();
    }
  }, [isPlaying, isBufferingNext, audio]);

  useEffect(() => {
    if (!isPlaying || isBufferingNext) return;
    let readyFails = 0;
    const id = window.setInterval(() => {
      if (!refs.isPlaying.current || refs.isBufferingNext.current) return;
      if (!audio.isActuallyPaused()) {
        readyFails = 0;
        return;
      }
      void audio.play().then((ok) => {
        if (ok || !audio.isActuallyPaused()) {
          readyFails = 0;
          return;
        }
        readyFails += 1;
        if (readyFails >= READY_RETRY_LIMIT) setIsPlaying(false);
      });
    }, READY_RETRY_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [isPlaying, isBufferingNext, refs, audio, setIsPlaying]);
}
