import { useState, useEffect } from "react";

export function useSleepTimer(setIsPlaying: (playing: boolean) => void) {
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
    const timer = setTimeout(() => {
      setSleepTimeLeft((t) => (t === null ? null : t - 1));
    }, 1000);
    return () => clearTimeout(timer);
  }, [sleepTimeLeft, setIsPlaying]);

  return { sleepPreset, setSleepPreset, sleepTimeLeft, setSleepTimeLeft };
}
