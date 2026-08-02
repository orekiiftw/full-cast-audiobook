import { useState, useEffect } from "react";

export function useSleepTimer(
  setIsPlaying: (playing: boolean) => void,
  isPlaying: boolean
) {
  const [sleepPreset, setSleepPreset] = useState<number | null>(null);
  const [sleepTimeLeft, setSleepTimeLeft] = useState<number | null>(null);

  useEffect(() => {
    if (sleepTimeLeft === null) return;
    if (sleepTimeLeft <= 0) {
      setIsPlaying(false);
      setSleepTimeLeft(null);
      setSleepPreset(null);
      return;
    }
    // The countdown only runs while playback is active. It used to tick while
    // paused: a 15-min timer set before a long pause would silently expire
    // mid-pause, clear itself, and be gone when playback resumed.
    if (!isPlaying) return;
    const timer = setTimeout(() => {
      setSleepTimeLeft((t) => (t === null ? null : t - 1));
    }, 1000);
    return () => clearTimeout(timer);
  }, [sleepTimeLeft, isPlaying, setIsPlaying]);

  return { sleepPreset, setSleepPreset, sleepTimeLeft, setSleepTimeLeft };
}
