import { useEffect, useRef, useCallback, useState } from "react";
import { getSharedAudio } from "../lib/sharedAudio";

interface UseAudioPlayerOptions {
  onEnded?: () => void;
  onTimeUpdate?: (positionMs: number) => void;
  /** Fired when play() fails due to autoplay policy (UI should show Play). */
  onPlayBlocked?: () => void;
}

function waitForEvent(
  audio: HTMLAudioElement,
  event: string,
  timeoutMs: number
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      audio.removeEventListener(event, onEvent);
      resolve(ok);
    };
    const onEvent = () => finish(true);
    const timer = window.setTimeout(() => finish(false), timeoutMs);
    audio.addEventListener(event, onEvent);
  });
}

export function useAudioPlayer({
  onEnded,
  onTimeUpdate,
  onPlayBlocked,
}: UseAudioPlayerOptions = {}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isReady, setIsReady] = useState(false);
  /** User/app wants playback; retry when the element becomes playable. */
  const wantPlayingRef = useRef(false);
  const playGenerationRef = useRef(0);
  const onEndedRef = useRef(onEnded);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const onPlayBlockedRef = useRef(onPlayBlocked);

  useEffect(() => {
    onEndedRef.current = onEnded;
    onTimeUpdateRef.current = onTimeUpdate;
    onPlayBlockedRef.current = onPlayBlocked;
  }, [onEnded, onTimeUpdate, onPlayBlocked]);

  useEffect(() => {
    // Reuse the app-wide element so the click-time unlock still applies.
    const audio = getSharedAudio();
    audio.preload = "auto";
    audioRef.current = audio;

    const tryAutoResume = () => {
      setIsReady(true);
      if (wantPlayingRef.current && audio.paused && audio.src && !audio.src.startsWith("data:")) {
        void audio.play().catch((err: unknown) => {
          const name = err instanceof Error ? err.name : "";
          if (name === "NotAllowedError") {
            wantPlayingRef.current = false;
            onPlayBlockedRef.current?.();
          } else {
            console.warn("Audio play was blocked:", err);
          }
        });
      }
    };

    const handleEmptied = () => setIsReady(false);

    const handleTimeUpdate = () => {
      onTimeUpdateRef.current?.(Math.round(audio.currentTime * 1000));
    };

    // Keep wantPlaying across segment boundaries. Explicit pause() clears it.
    const handleEnded = () => {
      onEndedRef.current?.();
    };

    // Stalled at 0 after load — common with WAV; kick play again if still wanted
    const handleStalled = () => {
      if (wantPlayingRef.current && audio.paused && audio.src) {
        void audio.play().catch(() => {
          /* retry via canplay */
        });
      }
    };

    const handleWaiting = () => {
      // no-op; browser is buffering
    };

    audio.addEventListener("canplay", tryAutoResume);
    audio.addEventListener("canplaythrough", tryAutoResume);
    audio.addEventListener("loadeddata", tryAutoResume);
    audio.addEventListener("emptied", handleEmptied);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("stalled", handleStalled);
    audio.addEventListener("waiting", handleWaiting);
    audio.addEventListener("suspend", handleStalled);

    return () => {
      audio.removeEventListener("canplay", tryAutoResume);
      audio.removeEventListener("canplaythrough", tryAutoResume);
      audio.removeEventListener("loadeddata", tryAutoResume);
      audio.removeEventListener("emptied", handleEmptied);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("stalled", handleStalled);
      audio.removeEventListener("waiting", handleWaiting);
      audio.removeEventListener("suspend", handleStalled);
      // Do NOT destroy the shared element or clear src here — chapter changes
      // remount Player and must keep the unlocked element alive.
      audioRef.current = null;
    };
  }, []);

  const play = useCallback(async (): Promise<boolean> => {
    wantPlayingRef.current = true;
    const audio = audioRef.current ?? getSharedAudio();
    audioRef.current = audio;
    if (!audio.src || audio.src.startsWith("data:")) return false;

    const generation = ++playGenerationRef.current;
    try {
      if (audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
        await waitForEvent(audio, "canplay", 6000);
      }
      if (!wantPlayingRef.current || generation !== playGenerationRef.current) return false;

      // If a seek is mid-flight, wait so play isn't aborted by currentTime assignment
      if (audio.seeking) {
        await waitForEvent(audio, "seeked", 2000);
      }
      if (!wantPlayingRef.current || generation !== playGenerationRef.current) return false;

      await audio.play();
      return true;
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : "";
      if (name === "AbortError") {
        // load()/seek interrupted play — canplay handler will retry if still wanted
        return false;
      }
      if (name === "NotAllowedError") {
        console.warn("Audio play was blocked by browser policy:", err);
        wantPlayingRef.current = false;
        onPlayBlockedRef.current?.();
        return false;
      }
      console.warn("Audio play failed:", err);
      return false;
    }
  }, []);

  const pause = useCallback(() => {
    wantPlayingRef.current = false;
    playGenerationRef.current += 1;
    const audio = audioRef.current ?? sharedOrNull();
    audio?.pause();
  }, []);

  const setSrc = useCallback((src: string, force = false) => {
    const audio = audioRef.current ?? getSharedAudio();
    audioRef.current = audio;
    const absolute = new URL(src, window.location.href).href;
    if (!force && audio.src === absolute) return;
    setIsReady(false);
    // Bump generation so an in-flight play() from the previous source aborts cleanly
    playGenerationRef.current += 1;
    audio.src = src;
    audio.load();
  }, []);

  /**
   * Load source, optionally seek, then play — serialized to avoid AbortError races
   * that leave the UI in a "playing" state while the element is paused at 0:00.
   */
  const loadAndPlay = useCallback(
    async (src: string, seekSec: number | null = null, force = false): Promise<boolean> => {
      wantPlayingRef.current = true;
      const audio = audioRef.current ?? getSharedAudio();
      audioRef.current = audio;

      const absolute = new URL(src, window.location.href).href;
      const needsLoad = force || audio.src !== absolute;

      if (needsLoad) {
        setIsReady(false);
        playGenerationRef.current += 1;
        audio.src = src;
        audio.load();
      }

      const generation = ++playGenerationRef.current;

      if (audio.readyState < HTMLMediaElement.HAVE_METADATA) {
        await waitForEvent(audio, "loadedmetadata", 6000);
      }
      if (!wantPlayingRef.current || generation !== playGenerationRef.current) return false;

      // Skip no-op 0 seeks — assigning currentTime=0 can stall some WAV decoders
      if (seekSec != null && seekSec > 0.05) {
        const duration = audio.duration;
        const max =
          Number.isFinite(duration) && duration > 0 ? duration : Number.POSITIVE_INFINITY;
        const target = Math.max(0, Math.min(seekSec, max));
        if (Math.abs(audio.currentTime - target) > 0.05) {
          audio.currentTime = target;
          if (audio.seeking) {
            await waitForEvent(audio, "seeked", 2000);
          }
        }
      }

      if (audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
        await waitForEvent(audio, "canplay", 6000);
      }
      if (!wantPlayingRef.current || generation !== playGenerationRef.current) return false;

      try {
        await audio.play();
        setIsReady(true);
        return true;
      } catch (err: unknown) {
        const name = err instanceof Error ? err.name : "";
        if (name === "AbortError") return false;
        if (name === "NotAllowedError") {
          console.warn("Audio play was blocked by browser policy:", err);
          wantPlayingRef.current = false;
          onPlayBlockedRef.current?.();
          return false;
        }
        console.warn("Audio loadAndPlay failed:", err);
        return false;
      }
    },
    []
  );

  const seekTo = useCallback((timeSeconds: number) => {
    const audio = audioRef.current ?? getSharedAudio();
    if (!audio || !Number.isFinite(timeSeconds)) return;
    const duration = audio.duration;
    const max =
      Number.isFinite(duration) && duration > 0 ? duration : Number.POSITIVE_INFINITY;
    const target = Math.max(0, Math.min(timeSeconds, max));
    // Avoid redundant 0-seeks that stall decoding at the start of a file
    if (Math.abs(audio.currentTime - target) < 0.02) return;
    audio.currentTime = target;
  }, []);

  const setPlaybackRate = useCallback((rate: number) => {
    const audio = audioRef.current ?? getSharedAudio();
    audio.playbackRate = rate;
  }, []);

  const getCurrentTime = useCallback(() => {
    return (audioRef.current ?? getSharedAudio()).currentTime ?? 0;
  }, []);

  const getDuration = useCallback(() => {
    return (audioRef.current ?? getSharedAudio()).duration ?? 0;
  }, []);

  const getBufferedRanges = useCallback((): Array<{ start: number; end: number }> => {
    const audio = audioRef.current ?? getSharedAudio();
    const ranges: Array<{ start: number; end: number }> = [];
    for (let i = 0; i < audio.buffered.length; i++) {
      ranges.push({ start: audio.buffered.start(i), end: audio.buffered.end(i) });
    }
    return ranges;
  }, []);

  const isActuallyPaused = useCallback(() => {
    const audio = audioRef.current ?? getSharedAudio();
    return audio.paused;
  }, []);

  return {
    isReady,
    play,
    pause,
    setSrc,
    loadAndPlay,
    seekTo,
    setPlaybackRate,
    getCurrentTime,
    getDuration,
    getBufferedRanges,
    isActuallyPaused,
    audioRef,
  };
}

function sharedOrNull(): HTMLAudioElement | null {
  try {
    return getSharedAudio();
  } catch {
    return null;
  }
}
