import { ensureWavBuffer } from "../../../audio/wav";
import {
  DEFAULT_SARVAM_TS_MODEL,
  DEFAULT_SARVAM_TS_SPEAKER,
  SARVAM_SPEAKERS,
  SARVAM_TS_BASE_URL,
  SARVAM_TS_MAX_CHARS,
  SARVAM_TS_SAMPLE_RATE,
} from "../../../lib/constants";
import { TtsApiError, TtsConfigError, TtsInputError } from "../errors";
import { parseRetryAfterMs, postSpeechRequest, synthesizeWithRetries } from "../http";
import { applyPronunciationDict } from "../pronunciation";
import { runWithTtsSlot } from "../rateLimit";
import type { DeliveryHint, TTSProvider } from "../types";

const PROVIDER_LABEL = "Sarvam TTS";
const MAX_ERROR_BODY_CHARS = 500;
const SARVAM_PACE_BY_HINT = new Map([
  ["slow", 0.8],
  ["fast", 1.2],
]);

class SarvamApiError extends TtsApiError {}

export class SarvamTSProvider implements TTSProvider {
  private readonly baseUrl = (process.env.SARVAM_TS_BASE_URL || SARVAM_TS_BASE_URL).replace(/\/+$/, "");
  private readonly model = process.env.SARVAM_TS_MODEL || DEFAULT_SARVAM_TS_MODEL;
  private readonly languageCode: string;

  constructor(bcp47: string) {
    this.languageCode = bcp47;
  }

  async speak(
    text: string,
    voiceName: string,
    _stylePrompt: string,
    pronunciationDict?: Record<string, string>,
    delivery?: DeliveryHint,
  ): Promise<Buffer> {
    return runWithTtsSlot(() => this.speakInternal(text, voiceName, pronunciationDict, delivery));
  }

  private async speakInternal(
    text: string,
    voiceName: string,
    pronunciationDict?: Record<string, string>,
    delivery?: DeliveryHint,
  ): Promise<Buffer> {
    const processedText = applyPronunciationDict(text, pronunciationDict);
    if (processedText.length > SARVAM_TS_MAX_CHARS) {
      throw new TtsInputError(`Sarvam TTS accepts at most ${SARVAM_TS_MAX_CHARS} characters per request; got ${processedText.length}.`);
    }

    const speaker = this.resolveSpeaker(voiceName);
    const pace = paceToSarvamPace(delivery?.pace);

    return synthesizeWithRetries({
      failurePrefix: "Sarvam TTS generation failed",
      describeAttempt: (attempt, maxAttempts) =>
        `🎙️ Sarvam TTS (Attempt ${attempt}/${maxAttempts}) speaker "${speaker}" lang "${this.languageCode}" pace ${pace} (${processedText.length} chars)`,
      send: () => this.requestSpeech(processedText, speaker, pace),
    });
  }

  private resolveSpeaker(voiceName: string): string {
    const trimmed = voiceName.trim().toLowerCase();
    if (SARVAM_SPEAKERS.has(trimmed)) return trimmed;
    const configured = (process.env.SARVAM_TS_SPEAKER || DEFAULT_SARVAM_TS_SPEAKER).trim().toLowerCase();
    return SARVAM_SPEAKERS.has(configured) ? configured : DEFAULT_SARVAM_TS_SPEAKER;
  }

  private async requestSpeech(processedText: string, speaker: string, pace: number): Promise<Buffer> {
    const res = await postSpeechRequest(
      `${this.baseUrl}/text-to-speech`,
      {
        "api-subscription-key": this.getApiKey(),
        "Content-Type": "application/json",
      },
      this.buildRequestBody(processedText, speaker, pace),
      PROVIDER_LABEL,
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new SarvamApiError(
        `Sarvam TTS API error ${res.status}: ${errorMessageFromBody(body) || res.statusText}`,
        res.status,
        parseRetryAfterMs(res.headers.get("retry-after")),
      );
    }

    const payload = (await res.json().catch(() => null)) as { audios?: unknown } | null;
    const firstAudio = Array.isArray(payload?.audios) ? payload?.audios[0] : undefined;
    if (typeof firstAudio !== "string" || !firstAudio) {
      throw new Error("Sarvam TTS returned no audio payload.");
    }

    const audio = Buffer.from(firstAudio, "base64");
    if (audio.length === 0) {
      throw new Error("Sarvam TTS returned an empty audio body.");
    }
    return ensureWavBuffer(audio);
  }

  private buildRequestBody(processedText: string, speaker: string, pace: number) {
    return {
      text: processedText,
      language_code: this.languageCode,
      speaker,
      model: this.model,
      pace,
      speech_sample_rate: SARVAM_TS_SAMPLE_RATE,
      output_audio_codec: "wav",
    };
  }

  private getApiKey(): string {
    const apiKey = process.env.SARVAM_API_KEY;
    if (!apiKey) {
      throw new TtsConfigError("SARVAM_API_KEY environment variable is not set.");
    }
    return apiKey;
  }
}

function errorMessageFromBody(body: string): string {
  const fallback = body.slice(0, MAX_ERROR_BODY_CHARS);
  try {
    const parsed = JSON.parse(body) as { message?: string | string[] };
    if (!parsed.message) return fallback;
    return Array.isArray(parsed.message) ? parsed.message.join(", ") : parsed.message;
  } catch {
    return fallback;
  }
}

function paceToSarvamPace(pace?: string): number {
  const baseRate = Number(process.env.SARVAM_TS_PACE) || 1;
  const hintScale = SARVAM_PACE_BY_HINT.get((pace ?? "").trim().toLowerCase()) ?? 1;
  return Math.min(2, Math.max(0.5, baseRate * hintScale));
}
