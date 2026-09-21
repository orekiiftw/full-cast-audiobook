import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { getSharedAudio } from "../../lib/sharedAudio";
import { hasRealSource } from "./audioTiming";

interface AudioElementHandlers {
  onEnded?: () => void;
  onTimeUpdate?: (positionMs: number) => void;
  onPlayBlocked?: () => void;
}

export interface AudioElementSession {
  audioRef: MutableRefObject<HTMLAudioElement | null>;
  wantsPlaybackRef: MutableRefObject<boolean>;
  playGenerationRef: MutableRefObject<number>;
  notifyPlayBlocked: () => void;
}

export function useAudioElement({ onEnded, onTimeUpdate, onPlayBlocked }: AudioElementHandlers = {}): AudioElementSession {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wantsPlaybackRef = useRef(false);
  const playGenerationRef = useRef(0);
  const onEndedRef = useRef(onEnded);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const onPlayBlockedRef = useRef(onPlayBlocked);

  useEffect(() => {
    onEndedRef.current = onEnded;
    onTimeUpdateRef.current = onTimeUpdate;
    onPlayBlockedRef.current = onPlayBlocked;
  }, [onEnded, onTimeUpdate, onPlayBlocked]);

  const notifyPlayBlocked = useCallback(() => {
    wantsPlaybackRef.current = false;
    onPlayBlockedRef.current?.();
  }, []);

  useEffect(() => {
    const audio = getSharedAudio();
    audio.preload = "auto";
    audioRef.current = audio;

    const resumeIfRequested = () => {
      if (!wantsPlaybackRef.current || !audio.paused || !hasRealSource(audio.src)) return;
      void audio.play().catch((err: unknown) => {
        if (err instanceof Error && err.name === "NotAllowedError") {
          notifyPlayBlocked();
          return;
        }
        console.warn("Audio play was blocked:", err);
      });
    };

    const restartIfStalled = () => {
      if (wantsPlaybackRef.current && audio.paused && audio.src) {
        void audio.play().catch(() => {});
      }
    };

    const reportTimeUpdate = () => {
      onTimeUpdateRef.current?.(Math.round(audio.currentTime * 1000));
    };

    const reportEnded = () => {
      onEndedRef.current?.();
    };

    audio.addEventListener("canplay", resumeIfRequested);
    audio.addEventListener("canplaythrough", resumeIfRequested);
    audio.addEventListener("loadeddata", resumeIfRequested);
    audio.addEventListener("timeupdate", reportTimeUpdate);
    audio.addEventListener("ended", reportEnded);
    audio.addEventListener("stalled", restartIfStalled);
    audio.addEventListener("suspend", restartIfStalled);

    return () => {
      audio.removeEventListener("canplay", resumeIfRequested);
      audio.removeEventListener("canplaythrough", resumeIfRequested);
      audio.removeEventListener("loadeddata", resumeIfRequested);
      audio.removeEventListener("timeupdate", reportTimeUpdate);
      audio.removeEventListener("ended", reportEnded);
      audio.removeEventListener("stalled", restartIfStalled);
      audio.removeEventListener("suspend", restartIfStalled);
      audioRef.current = null;
    };
  }, [notifyPlayBlocked]);

  return useMemo(() => ({ audioRef, wantsPlaybackRef, playGenerationRef, notifyPlayBlocked }), [playGenerationRef, notifyPlayBlocked]);
}
