// A status change used to mean a detail refetch, and the pipeline emits several in a row
// (discovering → casting → in_progress) inside a second or two — three 1.2s round trips where
// one would do, on a screen the listener is already looking at. A coalescer runs the work once
// per burst: the first call schedules it after `delayMs`, later calls inside the window join
// that run instead of pushing it further out, so latency stays bounded even under a steady
// stream of events.

export interface Coalescer {
  schedule: () => void;
  cancel: () => void;
  pending: () => boolean;
}

export interface TimerLike {
  set: (handler: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const defaultTimers: TimerLike = {
  set: (handler, ms) => setTimeout(handler, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createCoalescer(run: () => void, delayMs = 400, timers: TimerLike = defaultTimers): Coalescer {
  let handle: unknown = null;

  const cancel = () => {
    if (handle === null) return;
    timers.clear(handle);
    handle = null;
  };

  return {
    schedule() {
      if (handle !== null) return;
      handle = timers.set(() => {
        handle = null;
        run();
      }, delayMs);
    },
    cancel,
    pending() {
      return handle !== null;
    },
  };
}
