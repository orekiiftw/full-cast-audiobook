// `POST /api/media-tokens` costs 0.63s against the live server. The player used to sign each
// newly voiced line in its own request — one per `segment_ready` event, which the studio emits
// once a second while it voices — so a chapter streaming in meant dozens of round trips for
// URLs it would not need yet. The batcher collects the keys a render pass asked for, signs them
// in one request (the signer chunks above the route's 50-key cap), and never asks again for a
// key it already holds or has in flight.

export interface SignBatcher {
  // Resolves with every requested key the signer could produce; keys already held resolve on
  // the next microtask without a network call.
  request: (keys: string[]) => Promise<Record<string, string>>;
  // The URLs held right now, for callers that keep their own snapshot.
  held: () => Record<string, string>;
  // Keys queued for the next flush, freshly signed URLs excluded.
  pendingKeys: () => string[];
  dispose: () => void;
}

export interface SignBatcherOptions {
  flushMs?: number;
  timers?: { set: (handler: () => void, ms: number) => unknown; clear: (handle: unknown) => void };
}

const DEFAULT_FLUSH_MS = 180;

const immediateTimers = {
  set: (handler: () => void) => {
    const handle = setTimeout(handler, 0);
    return handle;
  },
  clear: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createSignBatcher(
  sign: (keys: string[]) => Promise<Record<string, string>>,
  options: SignBatcherOptions = {},
): SignBatcher {
  const flushMs = options.flushMs ?? DEFAULT_FLUSH_MS;
  const timers = options.timers ?? immediateTimers;
  const cache: Record<string, string> = {};
  const queued = new Set<string>();
  let waiters: { keys: string[]; resolve: (urls: Record<string, string>) => void }[] = [];
  let handle: unknown = null;
  let disposed = false;

  const settle = (keys: string[]): Record<string, string> => {
    const urls: Record<string, string> = {};
    for (const key of keys) {
      const url = cache[key];
      if (url) urls[key] = url;
    }
    return urls;
  };

  const flush = async () => {
    handle = null;
    const batch = [...queued];
    queued.clear();
    if (batch.length === 0) return;

    const current = waiters;
    waiters = [];

    try {
      const urls = await sign(batch);
      Object.assign(cache, urls);
      for (const waiter of current) waiter.resolve(settle(waiter.keys));
    } catch {
      // A failed signature is not a failed session: resolve with what is held (usually
      // nothing) so the caller falls back to its own retry (a reconnect refetch).
      for (const waiter of current) waiter.resolve(settle(waiter.keys));
    }
  };

  return {
    request(keys) {
      const unique: string[] = [];
      for (const key of keys) {
        if (!key || unique.includes(key)) continue;
        unique.push(key);
      }

      const missing = unique.filter((key) => !cache[key]);
      if (missing.length === 0 || disposed) {
        return Promise.resolve(settle(unique));
      }

      for (const key of missing) queued.add(key);
      const promise = new Promise<Record<string, string>>((resolve) => {
        waiters.push({ keys: unique, resolve });
      });

      if (handle === null) handle = timers.set(() => void flush(), flushMs);
      return promise;
    },

    held() {
      return { ...cache };
    },

    pendingKeys() {
      return [...queued];
    },

    dispose() {
      disposed = true;
      if (handle !== null) {
        timers.clear(handle);
        handle = null;
      }
      queued.clear();
      const current = waiters;
      waiters = [];
      for (const waiter of current) waiter.resolve(settle(waiter.keys));
    },
  };
}
