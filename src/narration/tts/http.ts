import { TTS } from "../../lib/constants";
import { TtsApiError, isRetryableError } from "./errors";
import { extendRateLimitCoolDown, waitForRateLimitGate } from "./rateLimit";
import { sleep } from "../../lib/async";

const REQUEST_TIMEOUT_MS = TTS.REQUEST_TIMEOUT_MS;

export async function postSpeechRequest(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  providerLabel: string,
): Promise<Response> {
  try {
    return await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error(`${providerLabel} request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw error;
  }
}

export function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const sec = Number(header);
  if (!Number.isNaN(sec) && sec >= 0) return Math.max(sec * 1000, 250);
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) return Math.max(dateMs - Date.now(), 250);
  return null;
}

interface SynthesisPlan {
  failurePrefix: string;
  describeAttempt: (attempt: number, maxAttempts: number) => string;
  send: () => Promise<Buffer>;
}

export async function synthesizeWithRetries(plan: SynthesisPlan): Promise<Buffer> {
  const maxAttempts = TTS.MAX_RETRIES;
  let lastError: unknown = null;
  let retryDelayMs: number = TTS.INITIAL_RETRY_DELAY_MS;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await waitForRateLimitGate();

    try {
      console.log(plan.describeAttempt(attempt, maxAttempts));
      return await plan.send();
    } catch (error: unknown) {
      lastError = error;
      const message = (error as { message?: string } | null)?.message || error;
      console.warn(`⚠️ Attempt ${attempt} failed: ${message}`);

      if (!isRetryableError(error)) {
        throw error instanceof Error ? error : new Error(String(error));
      }
      if (attempt === maxAttempts) break;

      retryDelayMs = await waitBeforeRetry(error, retryDelayMs);
    }
  }

  const reason = lastError instanceof Error ? lastError.message : String(lastError ?? "unknown error");
  throw new Error(`${plan.failurePrefix} after ${maxAttempts} attempts. Last error: ${reason}`);
}

async function waitBeforeRetry(error: unknown, retryDelayMs: number): Promise<number> {
  await sleep(rateLimitedSleepMs(error, retryDelayMs));
  return Math.min(retryDelayMs * 2, TTS.MAX_RETRY_AFTER_MS);
}

function rateLimitedSleepMs(error: unknown, fallbackMs: number): number {
  if (!(error instanceof TtsApiError) || error.status !== TTS.RATE_LIMIT_STATUS) return fallbackMs;

  const retryAfterMs = error.retryAfterMs;
  const sleepMs = retryAfterMs == null ? fallbackMs : Math.min(retryAfterMs, TTS.MAX_RETRY_AFTER_MS);
  if (retryAfterMs != null) extendRateLimitCoolDown(sleepMs);
  console.log(`⏳ Rate limited. Waiting ${Math.ceil(sleepMs / 1000)}s before retry…`);
  return sleepMs;
}
