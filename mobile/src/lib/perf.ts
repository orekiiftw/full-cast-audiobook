// A dev-only timing harness. Every number in the pull request's before/after table comes from
// these marks, so they stay deliberately small: a name, a timestamp, and a rAF frame sampler.
// Enabled under `__DEV__` or when `EXPO_PUBLIC_PERF_HUD=1` — the second flag is how the same
// build can be measured in a production web export, where `__DEV__` is false.

export interface PerfMark {
  name: string;
  at: number;
}

export const PERF_MARK_LIMIT = 240;

const marks: PerfMark[] = [];

export function perfEnabled(): boolean {
  return __DEV__ || process.env.EXPO_PUBLIC_PERF_HUD === "1";
}

export function perfMark(name: string, at: number = Date.now()): void {
  if (!perfEnabled()) return;
  marks.push({ name, at });
  if (marks.length > PERF_MARK_LIMIT) marks.splice(0, marks.length - PERF_MARK_LIMIT);
  if (__DEV__) console.log(`[perf] ${name} @ ${at % 100000}`);
}

export function perfMarks(): PerfMark[] {
  return [...marks];
}

export function perfReset(): void {
  marks.length = 0;
}

// Milliseconds from the latest `from` to the latest `to` recorded after it — the most recent
// time the pair happened, not the first. Null when either is absent, which is the honest answer
// when a screen was never reached.
export function perfSpan(from: string, to: string): number | null {
  let start: PerfMark | null = null;
  for (const mark of marks) {
    if (mark.name === from) start = mark;
  }
  if (!start) return null;
  let end: PerfMark | null = null;
  for (const mark of marks) {
    if (mark.name === to && mark.at >= start.at) end = mark;
  }
  return end ? Math.max(0, end.at - start.at) : null;
}

export function perfFormat(ms: number | null): string {
  if (ms === null) return "—";
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

export interface FrameSummary {
  frames: number;
  dropped: number;
  elapsedMs: number;
  worstMs: number;
  fps: number;
}

// A frame that arrives more than 1.5 budgets late counts as dropped: at 60Hz that is any gap
// over 25ms, which is the threshold below which a scroll still reads as smooth.
export function summarizeFrames(timestamps: number[]): FrameSummary {
  if (timestamps.length < 2) {
    return { frames: timestamps.length, dropped: 0, elapsedMs: 0, worstMs: 0, fps: 0 };
  }
  const elapsedMs = timestamps[timestamps.length - 1] - timestamps[0];
  const budget = 16.7;
  let dropped = 0;
  let worstMs = 0;
  for (let index = 1; index < timestamps.length; index++) {
    const gap = timestamps[index] - timestamps[index - 1];
    if (gap > worstMs) worstMs = gap;
    if (gap > budget * 1.5) dropped += 1;
  }
  const fps = elapsedMs > 0 ? ((timestamps.length - 1) / elapsedMs) * 1000 : 0;
  return { frames: timestamps.length, dropped, elapsedMs: Math.round(elapsedMs), worstMs: Math.round(worstMs), fps: Math.round(fps) };
}

// Samples the frame clock for `durationMs` and summarizes it. Used by the debug panel's
// "measure scroll" action and by the harness that drove the before/after runs.
export function sampleFrames(durationMs = 2000): Promise<FrameSummary> {
  return new Promise((resolve) => {
    const timestamps: number[] = [];
    const startedAt = Date.now();
    const tick = (now: number) => {
      timestamps.push(now);
      if (Date.now() - startedAt < durationMs) requestAnimationFrame(tick);
      else resolve(summarizeFrames(timestamps));
    };
    requestAnimationFrame(tick);
  });
}
