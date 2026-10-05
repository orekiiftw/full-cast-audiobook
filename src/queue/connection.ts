import { Redis, type RedisOptions } from "ioredis";
import { QUEUE } from "../lib/constants";

export const redisOptions = parseRedisUrl(QUEUE.REDIS_URL);

export const redis = new Redis(redisOptions);

export const redisSub = new Redis(redisOptions);

redis.on("error", (err) => console.warn("⚠️ Redis connection error:", err.message));

redisSub.on("error", (err) => console.warn("⚠️ Redis subscriber error:", err.message));

export async function pingRedis(timeoutMs = 15_000): Promise<void> {
  const result = await Promise.race([
    redis.ping().then(() => "ok" as const),
    new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), timeoutMs)),
  ]);
  if (result === "timeout") {
    throw new Error(
      `Could not reach Redis at ${redactedRedisUrl(QUEUE.REDIS_URL)} within ${timeoutMs}ms. ` +
        `The pipeline queue requires Redis — start one (e.g. "docker run -p 6379:6379 redis:7") ` +
        `or set REDIS_URL.`,
    );
  }
}

function parseRedisUrl(url: string): RedisOptions {
  const parsed = new URL(url);
  const db = parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : 0;
  return {
    host: parsed.hostname || "127.0.0.1",
    port: Number(parsed.port) || 6379,
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    db: Number.isFinite(db) ? db : 0,
    ...(parsed.protocol === "rediss:" ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}

function redactedRedisUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "(unparseable REDIS_URL)";
  }
}
