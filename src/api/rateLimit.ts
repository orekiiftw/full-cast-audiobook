const SWEEP_INTERVAL_MS = 60_000;

export type RateLimiter = (key: string) => boolean;

export interface RateLimitPolicy {
  windowMs: number;
  maxAttempts: number;
}

interface Attempt {
  count: number;
  resetAt: number;
}

export function createRateLimiter({ windowMs, maxAttempts }: RateLimitPolicy): RateLimiter {
  const attempts = new Map<string, Attempt>();
  let lastSweep = 0;

  const sweepExpired = (now: number): void => {
    if (now - lastSweep < SWEEP_INTERVAL_MS) return;
    lastSweep = now;
    for (const [key, entry] of attempts) {
      if (entry.resetAt <= now) attempts.delete(key);
    }
  };

  return (key: string): boolean => {
    const now = Date.now();
    sweepExpired(now);

    const entry = attempts.get(key);
    if (!entry || entry.resetAt <= now) {
      attempts.set(key, { count: 1, resetAt: now + windowMs });
      return false;
    }

    entry.count += 1;
    return entry.count > maxAttempts;
  };
}
