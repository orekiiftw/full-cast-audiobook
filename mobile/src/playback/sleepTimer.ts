// Port of `src/hooks/useSleepTimer.ts` as pure state transitions, so the countdown is
// testable without a device. The deadline is a wall-clock instant: pausing playback freezes
// the remaining seconds, resuming rebases them onto a new deadline, and reaching zero is the
// app's cue to stop playing and put the timer back to Off.

export interface SleepPreset {
  label: string;
  seconds: number | null;
}

export const SLEEP_PRESETS: SleepPreset[] = [
  { label: "Off", seconds: null },
  { label: "15 min", seconds: 900 },
  { label: "30 min", seconds: 1800 },
  { label: "45 min", seconds: 2700 },
  { label: "1 hr", seconds: 3600 },
];

export interface SleepState {
  preset: number | null;
  deadline: number | null;
  remainingSeconds: number | null;
}

export const SLEEP_OFF: SleepState = { preset: null, deadline: null, remainingSeconds: null };

export function deadlineFromSeconds(seconds: number | null, now: number): number | null {
  return seconds === null ? null : now + seconds * 1000;
}

export function secondsUntilDeadline(deadline: number | null, now: number): number | null {
  return deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1000));
}

// Choosing a preset starts the countdown from that many seconds (null = Off, clears it).
export function beginSleep(preset: number | null, now: number): SleepState {
  if (preset === null) return SLEEP_OFF;
  return { preset, deadline: deadlineFromSeconds(preset, now), remainingSeconds: preset };
}

// One tick of the one-second timer. Returns the next state and whether playback must stop.
export function tickSleep(state: SleepState, now: number, isPlaying: boolean): { state: SleepState; pauseNow: boolean } {
  if (state.remainingSeconds === null || state.deadline === null) return { state, pauseNow: false };

  if (state.remainingSeconds <= 0) {
    return { state: SLEEP_OFF, pauseNow: true };
  }

  if (!isPlaying) return { state, pauseNow: false };

  const remaining = secondsUntilDeadline(state.deadline, now);
  if (remaining === null) return { state, pauseNow: false };
  if (remaining <= 0) return { state: SLEEP_OFF, pauseNow: true };

  return { state: { ...state, remainingSeconds: remaining }, pauseNow: false };
}

// Playback resumed: rebase the frozen remaining seconds onto the current clock.
export function resumeSleep(state: SleepState, now: number): SleepState {
  if (state.remainingSeconds === null || state.remainingSeconds <= 0) return state;
  return { ...state, deadline: deadlineFromSeconds(state.remainingSeconds, now) };
}

export function formatSleepRemaining(remainingSeconds: number | null): string | null {
  if (remainingSeconds === null) return null;
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
