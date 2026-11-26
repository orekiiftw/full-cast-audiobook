import { createCoalescer, type TimerLike } from "@/lib/coalesce";

function manualTimers() {
  const scheduled: { handler: () => void; ms: number }[] = [];
  const timers: TimerLike = {
    set: (handler, ms) => {
      const entry = { handler, ms };
      scheduled.push(entry);
      return entry;
    },
    clear: (handle) => {
      const index = scheduled.indexOf(handle as { handler: () => void; ms: number });
      if (index >= 0) scheduled.splice(index, 1);
    },
  };
  return { scheduled, timers };
}

describe("createCoalescer", () => {
  it("runs a burst of calls once", () => {
    const { scheduled, timers } = manualTimers();
    let runs = 0;
    const coalescer = createCoalescer(
      () => {
        runs += 1;
      },
      400,
      timers,
    );

    coalescer.schedule();
    coalescer.schedule();
    coalescer.schedule();

    expect(scheduled).toHaveLength(1);
    scheduled[0].handler();
    expect(runs).toBe(1);
  });

  it("does not push the run further out when more calls arrive", () => {
    const { scheduled, timers } = manualTimers();
    const coalescer = createCoalescer(() => undefined, 400, timers);

    coalescer.schedule();
    expect(scheduled).toHaveLength(1);
    coalescer.schedule();
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].ms).toBe(400);
  });

  it("runs again after the window closed", () => {
    const { scheduled, timers } = manualTimers();
    let runs = 0;
    const coalescer = createCoalescer(
      () => {
        runs += 1;
      },
      400,
      timers,
    );

    coalescer.schedule();
    scheduled.shift()?.handler();
    expect(coalescer.pending()).toBe(false);
    coalescer.schedule();
    scheduled.shift()?.handler();
    expect(runs).toBe(2);
  });

  it("cancel drops a scheduled run", () => {
    const { scheduled, timers } = manualTimers();
    let runs = 0;
    const coalescer = createCoalescer(
      () => {
        runs += 1;
      },
      400,
      timers,
    );

    coalescer.schedule();
    coalescer.cancel();
    expect(coalescer.pending()).toBe(false);
    expect(scheduled).toHaveLength(0);
    expect(runs).toBe(0);
  });
});
