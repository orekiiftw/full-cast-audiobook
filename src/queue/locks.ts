import { randomUUID } from "crypto";
import { redis } from "./connection";

const lockKey = (name: string): string => `narratea:lock:${name}`;

export async function acquireLock(name: string, ttlMs: number): Promise<string | null> {
  const token = randomUUID();
  const result = await redis.set(lockKey(name), token, "PX", ttlMs, "NX");
  return result === "OK" ? token : null;
}

export async function isLockHeld(name: string): Promise<boolean> {
  return (await redis.exists(lockKey(name))) === 1;
}

export async function releaseLock(name: string, token: string): Promise<void> {
  await redis
    .eval(`if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`, 1, lockKey(name), token)
    .catch((err) => console.warn("⚠️ Failed to release lock:", err.message));
}
