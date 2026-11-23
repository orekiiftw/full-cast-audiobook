import { createHmac, randomBytes, timingSafeEqual } from "crypto";

const DEFAULT_TTL_SECONDS = 21_600;

let ephemeralSecret: string | null = null;

export function mediaTokenTtlSeconds(): number {
  const configured = Number(process.env.MEDIA_TOKEN_TTL_SECONDS);
  if (!Number.isSafeInteger(configured) || configured <= 0) return DEFAULT_TTL_SECONDS;
  return configured;
}

export function mediaTokenExpiry(now = Date.now()): number {
  return Math.floor(now / 1000) + mediaTokenTtlSeconds();
}

export function mediaSignature(key: string, userId: string, exp: number): string {
  return createHmac("sha256", mediaTokenSecret()).update(`${key}|${userId}|${exp}`, "utf8").digest("hex");
}

export function matchesMediaSignature(key: string, userId: string, exp: number, sig: string): boolean {
  const expected = Buffer.from(mediaSignature(key, userId, exp), "utf8");
  const presented = Buffer.from(sig.toLowerCase(), "utf8");
  if (expected.length !== presented.length) return false;
  return timingSafeEqual(expected, presented);
}

export function mediaExpiryValid(exp: number, now = Date.now()): boolean {
  return Number.isSafeInteger(exp) && exp * 1000 > now;
}

export function signedAudioUrl(key: string, userId: string, exp: number): string {
  return `/api/audio?key=${encodeURIComponent(key)}&exp=${exp}&sig=${mediaSignature(key, userId, exp)}`;
}

function mediaTokenSecret(): string {
  const configured = process.env.MEDIA_TOKEN_SECRET?.trim();
  if (configured) return configured;

  if (!ephemeralSecret) {
    ephemeralSecret = randomBytes(32).toString("base64url");
    console.warn(
      "⚠️ MEDIA_TOKEN_SECRET is not set — signing media URLs with an ephemeral per-process secret. Signed audio links stop working after a restart and across instances. Set MEDIA_TOKEN_SECRET in production.",
    );
  }
  return ephemeralSecret;
}
