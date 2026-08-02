import { useEffect, useRef, useCallback } from "react";
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

    audio.addEventListener("canplay", tryAutoResume);
    audio.addEventListener("canplaythrough", tryAutoResume);
    audio.addEventListener("loadeddata", tryAutoResume);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("stalled", handleStalled);
    audio.addEventListener("suspend", handleStalled);

    return () => {
      audio.removeEventListener("canplay", tryAutoResume);
      audio.removeEventListener("canplaythrough", tryAutoResume);
      audio.removeEventListener("loadeddata", tryAutoResume);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("stalled", handleStalled);
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

    // NOTE: play() must NOT bump the generation. loadAndPlay() bumps it to
    // serialize competing loads; if play() bumped it too, the transport
    // effect's play() (which runs in the same commit as the mount load)
    // invalidated an in-flight loadAndPlay before it applied the resume
    // seek — silently dropping the saved position on every chapter open.
    // play() reads the current generation and is aborted only by a newer
    // load (loadAndPlay/pause bump it).
    const generation = playGenerationRef.current;
    try {
      if (audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
        const playable = await waitForEvent(audio, "canplay", 6000);
        if (!playable) return false; // never became playable — don't play() blindly
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

  /**
   * Load source, optionally seek, then play — serialized to avoid AbortError races
   * that leave the UI in a "playing" state while the element is paused at 0:00.
   * `autoplay: false` callers load + seek + leave the element paused (scrubbing
   * across a segment boundary while paused, or resuming buffering after the
   * sleep timer paused the player) — loadAndPlay used to always play, so
   * "paused" callers got audible playback anyway.
   */
  const loadAndPlay = useCallback(
    async (src: string, seekSec: number | null = null, force = false, autoplay = true): Promise<boolean> => {
      wantPlayingRef.current = autoplay;
      const audio = audioRef.current ?? getSharedAudio();
      audioRef.current = audio;

      const absolute = new URL(src, window.location.href).href;
      const needsLoad = force || audio.src !== absolute;

      if (needsLoad) {
        playGenerationRef.current += 1;
        audio.src = src;
        audio.load();
      }

      const generation = ++playGenerationRef.current;

      if (audio.readyState < HTMLMediaElement.HAVE_METADATA) {
        const metadata = await waitForEvent(audio, "loadedmetadata", 6000);
        if (!metadata) return false;
      }
      // Only a newer load can supersede this one here — a pause during load
      // must NOT abort the seek (the position should land even if playback is
      // left paused), so wantPlayingRef is deliberately not checked yet.
      if (generation !== playGenerationRef.current) return false;

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

      if (!autoplay) return true; // loaded and positioned; element stays paused

      if (audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
        const playable = await waitForEvent(audio, "canplay", 6000);
        if (!playable) return false;
      }
      if (!wantPlayingRef.current || generation !== playGenerationRef.current) return false;

      try {
        await audio.play();
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

  const isActuallyPaused = useCallback(() => {
    const audio = audioRef.current ?? getSharedAudio();
    return audio.paused;
  }, []);

  return {
    play,
    pause,
    loadAndPlay,
    seekTo,
    setPlaybackRate,
    getCurrentTime,
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
