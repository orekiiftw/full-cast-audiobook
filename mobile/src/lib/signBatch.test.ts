import { createSignBatcher, type SignBatcherOptions } from "@/lib/signBatch";

function manualTimers() {
  const scheduled: { handler: () => void }[] = [];
  const timers: NonNullable<SignBatcherOptions["timers"]> = {
    set: (handler) => {
      const entry = { handler };
      scheduled.push(entry);
      return entry;
    },
    clear: (handle) => {
      const index = scheduled.indexOf(handle as { handler: () => void });
      if (index >= 0) scheduled.splice(index, 1);
    },
  };
  return {
    timers,
    flush: () => {
      const entry = scheduled.shift();
      entry?.handler();
    },
    scheduled,
  };
}

describe("createSignBatcher", () => {
  it("signs every key queued in one window with one request", async () => {
    const { timers, flush } = manualTimers();
    const calls: string[][] = [];
    const batcher = createSignBatcher(
      async (keys) => {
        calls.push(keys);
        return Object.fromEntries(keys.map((key) => [key, `/signed/${key}`]));
      },
      { flushMs: 180, timers },
    );

    const first = batcher.request(["a"]);
    const second = batcher.request(["b", "c"]);
    flush();

    await expect(first).resolves.toEqual({ a: "/signed/a" });
    await expect(second).resolves.toEqual({ b: "/signed/b", c: "/signed/c" });
    expect(calls).toEqual([["a", "b", "c"]]);
  });

  it("never asks twice for a key it already holds", async () => {
    const { timers, flush } = manualTimers();
    const calls: string[][] = [];
    const batcher = createSignBatcher(
      async (keys) => {
        calls.push(keys);
        return Object.fromEntries(keys.map((key) => [key, `/signed/${key}`]));
      },
      { timers },
    );

    batcher.request(["a"]);
    flush();
    await Promise.resolve();

    await expect(batcher.request(["a"])).resolves.toEqual({ a: "/signed/a" });
    expect(calls).toEqual([["a"]]);
  });

  it("does not queue the same key twice while it is in flight", async () => {
    const { timers, flush } = manualTimers();
    const calls: string[][] = [];
    const batcher = createSignBatcher(
      async (keys) => {
        calls.push(keys);
        return Object.fromEntries(keys.map((key) => [key, `/signed/${key}`]));
      },
      { timers },
    );

    const first = batcher.request(["a"]);
    const second = batcher.request(["a"]);
    expect(batcher.pendingKeys()).toEqual(["a"]);
    flush();

    await expect(first).resolves.toEqual({ a: "/signed/a" });
    await expect(second).resolves.toEqual({ a: "/signed/a" });
    expect(calls).toEqual([["a"]]);
  });

  it("resolves with what it holds when the signer fails, so the caller retries later", async () => {
    const { timers, flush } = manualTimers();
    let fail = false;
    const batcher = createSignBatcher(
      async (keys) => {
        if (fail) throw new Error("network");
        return Object.fromEntries(keys.map((key) => [key, `/signed/${key}`]));
      },
      { timers },
    );

    batcher.request(["a"]);
    flush();
    await Promise.resolve();

    fail = true;
    const pending = batcher.request(["a", "b"]);
    flush();
    await expect(pending).resolves.toEqual({ a: "/signed/a" });
  });

  it("dispose resolves waiters instead of leaving them hanging", async () => {
    const { timers } = manualTimers();
    const batcher = createSignBatcher(async () => ({}), { timers });
    const pending = batcher.request(["a"]);
    batcher.dispose();
    await expect(pending).resolves.toEqual({});
  });
});
