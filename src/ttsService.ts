import { ensureWavBuffer } from "./audioUtils";
import { readStreamWithCap } from "./lib/readStream";
import { PIPELINE, TTS, DEFAULT_TS_MODEL, MIMO_TS_BASE_URL, VOICEDESIGN_TS_MODEL } from "./lib/constants";

const MIMO_TTS_MODEL = process.env.MIMO_TS_MODEL || DEFAULT_TS_MODEL;
const MIMO_BASE_URL = (process.env.MIMO_TS_BASE_URL || MIMO_TS_BASE_URL).replace(/\/+$/, "");

/** Per-request timeout for a single MiMo synthesis call. */
const REQUEST_TIMEOUT_MS = TTS.REQUEST_TIMEOUT_MS;

/** Cap on a single TTS response body (audio arrives as base64 JSON — huge). */
const TTS_RESPONSE_CAP = 64 * 1024 * 1024;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface TTSProvider {
  speak(
    text: string,
    voiceName: string,
    stylePrompt: string,
    pronunciationDict?: Record<string, string>
  ): Promise<Buffer>;
}

/**
 * HTTP error from the MiMo API. `status` drives retry decisions;
 * `retryAfterMs` carries a parsed Retry-After header when present.
 */
class MiMoApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs: number | null = null
  ) {
    super(message);
    this.name = "MiMoApiError";
  }
}

/** Permanent configuration error (e.g. missing MIMO_API_KEY) — never retry. */
export class TtsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TtsConfigError";
  }
}

/** Shared gate so concurrent segment workers don't stampede a rate-limited TTS API. */
let rateLimitUntilMs = 0;

/**
 * Bounded concurrency for in-flight TTS requests. The MiMo account accepts
 * parallel synthesis calls, so serializing every request (the old speakChain)
 * capped throughput at one segment per ~8s and starved the "Listen Live"
 * experience. This limiter allows several calls to overlap while still
 * bounding total in-flight work; genuine 429s back-pressure everyone via the
 * shared rateLimitUntilMs gate above. Defaults to match the per-book worker
 * count, overridable via TTS_MAX_CONCURRENCY (must be >= 1).
 */
const TTS_MAX_CONCURRENCY = Math.max(1, Number(process.env.TTS_MAX_CONCURRENCY) || PIPELINE.MAX_WORKERS_PER_BOOK);
let activeTtsCalls = 0;
const ttsWaitQueue: Array<() => void> = [];

function acquireTtsSlot(): Promise<void> {
  if (activeTtsCalls < TTS_MAX_CONCURRENCY) {
    activeTtsCalls += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    ttsWaitQueue.push(() => {
      activeTtsCalls += 1;
      resolve();
    });
  });
}

function releaseTtsSlot(): void {
  activeTtsCalls = Math.max(0, activeTtsCalls - 1);
  const next = ttsWaitQueue.shift();
  if (next) next();
}

/** Transient statuses worth retrying; 400/401/403/422 fail immediately. */
const RETRYABLE_STATUSES = new Set([408, 409, 425, 429]);

/**
 * Compiled pronunciation substitutions, memoized on dict object identity.
 * getBookVoiceContext() hands out the same pDict object for the whole cache
 * TTL, so each term's RegExp (and replacement escaping) is built once per
 * book instead of on every beat synthesis call.
 */
const compiledDictCache = new WeakMap<Record<string, string>, Array<{ regex: RegExp; hint: string }>>();

function compiledDict(dict: Record<string, string>): Array<{ regex: RegExp; hint: string }> {
  let compiled = compiledDictCache.get(dict);
  if (!compiled) {
    compiled = Object.entries(dict).map(([term, hint]) => ({
      // Word-boundary lookarounds instead of \b: \b fails for terms edged with
      // punctuation — "Mr." compiles to \bMr\.\b, and no boundary exists after
      // the "." in "Mr. Darcy" — so the substitution silently never fired.
      regex: new RegExp(`(?<![\\w])${term.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")}(?![\\w])`, "gi"),
      // Escape `$` in the replacement so JS doesn't interpret special
      // patterns like $&, $`, $' that would duplicate surrounding text.
      hint: hint.replace(/\$/g, "$$$$"),
    }));
    compiledDictCache.set(dict, compiled);
  }
  return compiled;
}

/** Permanent configuration errors and deliberate 4xx responses are NOT retried. */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof TtsConfigError) return false;
  if (error instanceof MiMoApiError) {
    return RETRYABLE_STATUSES.has(error.status) || error.status >= 500;
  }
  // Network failures, timeouts, and malformed/empty payloads are transient
  return true;
}

/** Parses a Retry-After header value (delta-seconds or HTTP-date) into ms. */
function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const sec = Number(header);
  if (!Number.isNaN(sec) && sec >= 0) return Math.max(sec * 1000, 250);
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) return Math.max(dateMs - Date.now(), 250);
  return null;
}

interface MiMoChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
      audio?: { id?: string; data?: string };
    };
  }>;
  error?: { message?: string; code?: string; type?: string };
}

export class MiMoTSProvider implements TTSProvider {
  private getApiKey(): string {
    const apiKey = process.env.MIMO_API_KEY;
    if (!apiKey) {
      throw new TtsConfigError("MIMO_API_KEY environment variable is not set.");
    }
    return apiKey;
  }

  async speak(
    text: string,
    voiceName: string,
    stylePrompt: string,
    pronunciationDict?: Record<string, string>
  ): Promise<Buffer> {
    // Bound (not serialize) in-flight TTS calls. Concurrency is capped by
    // TTS_MAX_CONCURRENCY; genuine 429s still gate everyone via rateLimitUntilMs.
    await acquireTtsSlot();
    try {
      return await this.speakInternal(text, voiceName, stylePrompt, pronunciationDict);
    } finally {
      releaseTtsSlot();
    }
  }

  private buildRequestBody(voiceName: string, stylePrompt: string, processedText: string) {
    // MiMo rule: text to synthesize goes in the *assistant* message, verbatim.
    // The *user* message carries style instructions — for voicedesign it also
    // carries the voice description (voiceName) and audio.voice is omitted.
    const isVoiceDesign = MIMO_TTS_MODEL === VOICEDESIGN_TS_MODEL;
    return {
      model: MIMO_TTS_MODEL,
      messages: [
        { role: "user", content: isVoiceDesign ? `${voiceName}, ${stylePrompt}` : stylePrompt },
        { role: "assistant", content: processedText },
      ],
      audio: isVoiceDesign
        ? { format: "wav" }
        : { format: "wav", voice: voiceName },
    };
  }

  private async requestSpeech(voiceName: string, stylePrompt: string, processedText: string): Promise<Buffer> {
    let res: Response;
    try {
      res = await fetch(`${MIMO_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "api-key": this.getApiKey(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(this.buildRequestBody(voiceName, stylePrompt, processedText)),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new Error(`MiMo TTS request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
      }
      throw error;
    }

    const json = (await readResponseJson(res)) as MiMoChatResponse | null;
    if (!res.ok) {
      const apiMsg = json?.error?.message;
      throw new MiMoApiError(
        `MiMo TTS API error ${res.status}: ${apiMsg || res.statusText}`,
        res.status,
        parseRetryAfterMs(res.headers.get("retry-after"))
      );
    }

    // Audio lives ONLY in message.audio.data (message.content is an empty string)
    const data = json?.choices?.[0]?.message?.audio?.data;
    if (!data) {
      const apiMsg = json?.error?.message;
      throw new Error(
        `No audio payload returned from MiMo TTS API.${apiMsg ? ` API error: ${apiMsg}` : ""}`
      );
    }

    return ensureWavBuffer(Buffer.from(data, "base64"));
  }

  private async speakInternal(
    text: string,
    voiceName: string,
    stylePrompt: string,
    pronunciationDict?: Record<string, string>
  ): Promise<Buffer> {
    let processedText = text;
    if (pronunciationDict) {
      for (const { regex, hint } of compiledDict(pronunciationDict)) {
        processedText = processedText.replace(regex, hint);
      }
    }

    let lastError: unknown = null;
    let delay: number = TTS.INITIAL_RETRY_DELAY_MS;
    const maxAttempts = TTS.MAX_RETRIES;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Honor global rate-limit cool-down from prior failures
      const waitForGate = rateLimitUntilMs - Date.now();
      if (waitForGate > 0) {
        console.log(`⏳ TTS cool-down ${Math.ceil(waitForGate / 1000)}s (shared rate-limit gate)…`);
        await new Promise((r) => setTimeout(r, waitForGate));
      }

      try {
        // Never log stylePrompt verbatim: it contains book-derived annotation
        // output and user regen instructions (sensitive content + log volume).
        console.log(
          `🎙️ MiMo TTS (Attempt ${attempt}/${maxAttempts}) for voice "${voiceName}" (${processedText.length} chars)`
        );

        return await this.requestSpeech(voiceName, stylePrompt, processedText);
      } catch (error: unknown) {
        lastError = error;
        const err = error as { message?: string };
        console.warn(`⚠️ Attempt ${attempt} failed: ${err?.message || error}`);

        if (!isRetryableError(error)) {
          throw error instanceof Error ? error : new Error(String(error));
        }
        if (attempt === maxAttempts) break;

        // Honor Retry-After on 429 and hold other workers behind the same gate
        let sleepMs = delay;
        if (error instanceof MiMoApiError && error.status === TTS.RATE_LIMIT_STATUS) {
          const retryMs = error.retryAfterMs;
          if (retryMs != null) {
            // A malformed or overly long header must not block the global
            // serialized queue indefinitely. The current segment will retry
            // normally and its pipeline-level retry remains available.
            sleepMs = Math.min(retryMs, TTS.MAX_RETRY_AFTER_MS);
            rateLimitUntilMs = Math.max(rateLimitUntilMs, Date.now() + sleepMs);
          }
          console.log(`⏳ Rate limited. Waiting ${Math.ceil(sleepMs / 1000)}s before retry…`);
        }

        await sleep(sleepMs);
        delay = Math.min(delay * 2, TTS.MAX_RETRY_AFTER_MS);
      }
    }

    const msg =
      lastError instanceof Error ? lastError.message : String(lastError ?? "unknown error");
    throw new Error(
      `MiMo TTS generation failed after ${maxAttempts} attempts. Last error: ${msg}`
    );
  }
}

let sharedProvider: MiMoTSProvider | null = null;

/** Reads a MiMo response body as JSON with a hard size cap (unbounded
 *  res.json() could buffer a runaway payload wholesale). */
async function readResponseJson(res: Response): Promise<MiMoChatResponse | null> {
  if (!res.body) return null;
  try {
    const buffer = await readStreamWithCap(res.body, TTS_RESPONSE_CAP, () =>
      new Error("MiMo TTS response exceeded the 64MB size limit.")
    );
    return JSON.parse(buffer.toString("utf-8")) as MiMoChatResponse;
  } catch {
    return null;
  }
}

export function getTTSProvider(): MiMoTSProvider {
  if (!sharedProvider) sharedProvider = new MiMoTSProvider();
  return sharedProvider;
}
