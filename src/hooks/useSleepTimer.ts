import { useState, useEffect, useRef, useCallback } from "react";

const TICK_INTERVAL_MS = 1000;

export interface SleepTimer {
  sleepPreset: number | null;
  setSleepPreset: (preset: number | null) => void;
  sleepTimeLeft: number | null;
  setSleepTimeLeft: (seconds: number | null) => void;
}

function deadlineFromSeconds(seconds: number | null, now: number): number | null {
  return seconds === null ? null : now + seconds * 1000;
}

function secondsUntilDeadline(deadline: number | null, now: number): number | null {
  return deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1000));
}

export function useSleepTimer(setIsPlaying: (playing: boolean) => void, isPlaying: boolean): SleepTimer {
  const [sleepPreset, setSleepPresetState] = useState<number | null>(null);
  const [sleepTimeLeft, setSleepTimeLeftState] = useState<number | null>(null);
  const deadlineRef = useRef<number | null>(null);
  const wasPlayingRef = useRef(isPlaying);

  const setSleepPreset = useCallback((preset: number | null) => {
    setSleepPresetState(preset);
  }, []);

  const setSleepTimeLeft = useCallback((seconds: number | null) => {
    deadlineRef.current = deadlineFromSeconds(seconds, Date.now());
    setSleepTimeLeftState(seconds);
  }, []);

  useEffect(() => {
    const wasPlaying = wasPlayingRef.current;
    wasPlayingRef.current = isPlaying;
    if (isPlaying && !wasPlaying && sleepTimeLeft !== null && sleepTimeLeft > 0) {
      deadlineRef.current = deadlineFromSeconds(sleepTimeLeft, Date.now());
    }
  }, [isPlaying, sleepTimeLeft]);

  useEffect(() => {
    if (sleepTimeLeft === null) return;

    if (sleepTimeLeft <= 0) {
      setIsPlaying(false);
      setSleepTimeLeftState(null);
      setSleepPresetState(null);
      deadlineRef.current = null;
      return;
    }

    if (!isPlaying) return;

    const timer = setTimeout(() => {
      setSleepTimeLeftState(secondsUntilDeadline(deadlineRef.current, Date.now()));
    }, TICK_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [sleepTimeLeft, isPlaying, setIsPlaying]);

  return { sleepPreset, setSleepPreset, sleepTimeLeft, setSleepTimeLeft };
}
