import { useCallback, useEffect, useRef } from "react";
import { segmentAudioSrc } from "../../lib/format";
import { isPlayableSegment } from "../../lib/segmentStatus";
import type { Segment } from "../../types/api";
import { findNextIndex, loadedSegmentId, segmentSourceKey } from "./playbackMath";
import type { AudioTransport } from "./useAudioTransport";

interface LoadOptions {
  force?: boolean;
  autoplay?: boolean;
}

interface SegmentSources {
  loadSegmentSource: (segment: Segment, options?: LoadOptions) => void;
  prefetchNextSegment: (segments: Segment[], index: number) => void;
  queueSeek: (seconds: number | null) => void;
  isSegmentLoaded: (segment: Segment) => boolean;
  getLoadedSegmentId: () => string | null;
  restartSegmentSource: (segment: Segment, autoplay: boolean) => void;
}

export function useSegmentSources(audio: AudioTransport): SegmentSources {
  const lastSrcRef = useRef<string | null>(null);
  const loadedSegmentKeyRef = useRef<string | null>(null);
  const pendingSeekSecRef = useRef<number | null>(null);
  const prefetchAudioRef = useRef<HTMLAudioElement | null>(null);
  const prefetchUrlRef = useRef<string | null>(null);

  const loadSegmentSource = useCallback(
    (segment: Segment, options: LoadOptions = {}) => {
      if (!segment.audioUrl) return;
      const force = options.force ?? false;
      const autoplay = options.autoplay ?? false;
      const base = segmentAudioSrc(segment.audioUrl, segment.durationMs);
      const src = force ? `${base}&_=${Date.now()}` : base;
      const key = segmentSourceKey(segment, src);
      const isSame = !force && loadedSegmentKeyRef.current === key && lastSrcRef.current === base;

      const seekSec = pendingSeekSecRef.current;
      if (seekSec != null) pendingSeekSecRef.current = null;

      lastSrcRef.current = src;
      loadedSegmentKeyRef.current = key;
      if (!isSame) {
        void audio.loadAndPlay(src, seekSec, force, autoplay);
      } else if (autoplay) {
        void audio.play();
      }
    },
    [audio],
  );

  const prefetchNextSegment = useCallback((segments: Segment[], index: number) => {
    const next = findNextIndex(segments, index);
    if (next < 0) return;
    const segment = segments[next];
    if (!segment || !isPlayableSegment(segment) || !segment.audioUrl) return;

    const url = segmentAudioSrc(segment.audioUrl, segment.durationMs);
    if (prefetchUrlRef.current === url) return;

    if (!prefetchAudioRef.current) {
      const element = new Audio();
      element.preload = "auto";
      element.muted = true;
      prefetchAudioRef.current = element;
    }
    const element = prefetchAudioRef.current;
    element.src = url;
    element.load();
    prefetchUrlRef.current = url;
  }, []);

  const queueSeek = useCallback((seconds: number | null) => {
    pendingSeekSecRef.current = seconds;
  }, []);

  const isSegmentLoaded = useCallback((segment: Segment) => {
    if (!segment.audioUrl) return false;
    return loadedSegmentKeyRef.current === segmentSourceKey(segment, segmentAudioSrc(segment.audioUrl, segment.durationMs));
  }, []);

  const getLoadedSegmentId = useCallback(() => loadedSegmentId(loadedSegmentKeyRef.current), []);

  const restartSegmentSource = useCallback(
    (segment: Segment, autoplay: boolean) => {
      lastSrcRef.current = null;
      loadedSegmentKeyRef.current = null;
      loadSegmentSource(segment, { force: true, autoplay });
    },
    [loadSegmentSource],
  );

  useEffect(() => {
    return () => {
      const element = prefetchAudioRef.current;
      if (element) {
        element.removeAttribute("src");
        element.load();
      }
      prefetchAudioRef.current = null;
      prefetchUrlRef.current = null;
    };
  }, []);

  return { loadSegmentSource, prefetchNextSegment, queueSeek, isSegmentLoaded, getLoadedSegmentId, restartSegmentSource };
}
