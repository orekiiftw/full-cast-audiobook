import { useCallback, useMemo } from "react";
import { getSharedAudio } from "../../lib/sharedAudio";
import {
  AUDIO_READY_TIMEOUT_MS,
  AUDIO_SEEK_TIMEOUT_MS,
  SEEK_EPSILON_SEC,
  hasRealSource,
  resolveSeekSeconds,
  waitForEvent,
} from "./audioTiming";
import type { AudioElementSession } from "./useAudioElement";

export interface AudioTransport {
  play: () => Promise<boolean>;
  pause: () => void;
  loadAndPlay: (src: string, seekSec?: number | null, force?: boolean, autoplay?: boolean) => Promise<boolean>;
  seekTo: (timeSeconds: number) => void;
  setPlaybackRate: (rate: number) => void;
  getCurrentTime: () => number;
  isActuallyPaused: () => boolean;
}

export function useAudioTransport(session: AudioElementSession): AudioTransport {
  const { audioRef, wantsPlaybackRef } = session;

  const play = useCallback(() => playElement(session), [session]);

  const pause = useCallback(() => {
    wantsPlaybackRef.current = false;
    (audioRef.current ?? getSharedAudio()).pause();
  }, [audioRef, wantsPlaybackRef]);

  const loadAndPlay = useCallback(
    (src: string, seekSec: number | null = null, force = false, autoplay = true) =>
      loadElementAndPlay(session, src, seekSec, force, autoplay),
    [session],
  );

  const seekTo = useCallback(
    (timeSeconds: number) => {
      const audio = audioRef.current ?? getSharedAudio();
      if (!Number.isFinite(timeSeconds)) return;
      const target = resolveSeekSeconds(timeSeconds, audio.duration);
      if (Math.abs(audio.currentTime - target) < 0.02) return;
      audio.currentTime = target;
    },
    [audioRef],
  );

  const setPlaybackRate = useCallback(
    (rate: number) => {
      (audioRef.current ?? getSharedAudio()).playbackRate = rate;
    },
    [audioRef],
  );

  const getCurrentTime = useCallback(() => (audioRef.current ?? getSharedAudio()).currentTime ?? 0, [audioRef]);

  const isActuallyPaused = useCallback(() => (audioRef.current ?? getSharedAudio()).paused, [audioRef]);

  return useMemo(
    () => ({ play, pause, loadAndPlay, seekTo, setPlaybackRate, getCurrentTime, isActuallyPaused }),
    [play, pause, loadAndPlay, seekTo, setPlaybackRate, getCurrentTime, isActuallyPaused],
  );
}

async function playElement(session: AudioElementSession): Promise<boolean> {
  session.wantsPlaybackRef.current = true;
  const audio = session.audioRef.current ?? getSharedAudio();
  session.audioRef.current = audio;
  if (!hasRealSource(audio.src)) return false;

  const generation = session.playGenerationRef.current;
  if (!(await reachReadyState(audio, HTMLMediaElement.HAVE_FUTURE_DATA, "canplay"))) return false;
  if (!isStillCurrent(session, generation)) return false;

  if (audio.seeking) {
    await waitForEvent(audio, "seeked", AUDIO_SEEK_TIMEOUT_MS);
  }
  if (!isStillCurrent(session, generation)) return false;

  try {
    await audio.play();
    return true;
  } catch (err) {
    return reportPlayFailure(err, session.notifyPlayBlocked, "Audio play failed:");
  }
}

async function loadElementAndPlay(
  session: AudioElementSession,
  src: string,
  seekSec: number | null,
  force: boolean,
  autoplay: boolean,
): Promise<boolean> {
  session.wantsPlaybackRef.current = autoplay;
  const audio = session.audioRef.current ?? getSharedAudio();
  session.audioRef.current = audio;

  const absolute = new URL(src, window.location.href).href;
  if (force || audio.src !== absolute) {
    session.playGenerationRef.current += 1;
    audio.src = src;
    audio.load();
  }

  const generation = ++session.playGenerationRef.current;
  if (!(await reachReadyState(audio, HTMLMediaElement.HAVE_METADATA, "loadedmetadata"))) return false;
  if (!isStillCurrent(session, generation)) return false;

  if (seekSec != null && seekSec > SEEK_EPSILON_SEC) {
    seekElement(audio, seekSec);
    if (audio.seeking) {
      await waitForEvent(audio, "seeked", AUDIO_SEEK_TIMEOUT_MS);
    }
  }

  if (!autoplay) return true;
  if (!(await reachReadyState(audio, HTMLMediaElement.HAVE_FUTURE_DATA, "canplay"))) return false;
  if (!isStillCurrent(session, generation)) return false;

  try {
    await audio.play();
    return true;
  } catch (err) {
    return reportPlayFailure(err, session.notifyPlayBlocked, "Audio loadAndPlay failed:");
  }
}

async function reachReadyState(audio: HTMLAudioElement, readyState: number, event: string): Promise<boolean> {
  if (audio.readyState >= readyState) return true;
  return waitForEvent(audio, event, AUDIO_READY_TIMEOUT_MS);
}

function isStillCurrent(session: AudioElementSession, generation: number): boolean {
  return session.wantsPlaybackRef.current && generation === session.playGenerationRef.current;
}

function seekElement(audio: HTMLAudioElement, seekSec: number): void {
  const target = resolveSeekSeconds(seekSec, audio.duration);
  if (Math.abs(audio.currentTime - target) <= SEEK_EPSILON_SEC) return;
  audio.currentTime = target;
}

function reportPlayFailure(err: unknown, notifyPlayBlocked: () => void, message: string): boolean {
  const name = err instanceof Error ? err.name : "";
  if (name === "AbortError") return false;
  if (name === "NotAllowedError") {
    console.warn("Audio play was blocked by browser policy:", err);
    notifyPlayBlocked();
    return false;
  }
  console.warn(message, err);
  return false;
}
