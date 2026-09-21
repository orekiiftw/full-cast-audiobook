export const AUDIO_READY_TIMEOUT_MS = 6000;
export const AUDIO_SEEK_TIMEOUT_MS = 2000;
export const SEEK_EPSILON_SEC = 0.05;

export function waitForEvent(audio: HTMLAudioElement, event: string, timeoutMs: number): Promise<boolean> {
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

export function resolveSeekSeconds(seconds: number, duration: number): number {
  const max = Number.isFinite(duration) && duration > 0 ? duration : Number.POSITIVE_INFINITY;
  return Math.max(0, Math.min(seconds, max));
}

export function hasRealSource(src: string): boolean {
  return !!src && !src.startsWith("data:");
}
