import { ensureWavBuffer } from "../../../audio/wav";
import { readStreamWithCap } from "../../../lib/readStream";
import { DEFAULT_TS_MODEL, MIMO_TS_BASE_URL, VOICEDESIGN_TS_MODEL } from "../../../lib/constants";
import { TtsApiError, TtsConfigError } from "../errors";
import { parseRetryAfterMs, postSpeechRequest, synthesizeWithRetries } from "../http";
import { applyPronunciationDict } from "../pronunciation";
import { runWithTtsSlot } from "../rateLimit";
import type { TTSProvider } from "../types";

const MIMO_TTS_MODEL = process.env.MIMO_TS_MODEL || DEFAULT_TS_MODEL;

const MIMO_BASE_URL = (process.env.MIMO_TS_BASE_URL || MIMO_TS_BASE_URL).replace(/\/+$/, "");

const TTS_RESPONSE_CAP = 64 * 1024 * 1024;

const PROVIDER_LABEL = "MiMo TTS";

class MiMoApiError extends TtsApiError {}

export class MiMoTSProvider implements TTSProvider {
  async speak(text: string, voiceName: string, stylePrompt: string, pronunciationDict?: Record<string, string>): Promise<Buffer> {
    return runWithTtsSlot(() => this.speakInternal(text, voiceName, stylePrompt, pronunciationDict));
  }

  private async speakInternal(
    text: string,
    voiceName: string,
    stylePrompt: string,
    pronunciationDict?: Record<string, string>,
  ): Promise<Buffer> {
    const processedText = applyPronunciationDict(text, pronunciationDict);

    return synthesizeWithRetries({
      failurePrefix: "MiMo TTS generation failed",
      describeAttempt: (attempt, maxAttempts) =>
        `🎙️ MiMo TTS (Attempt ${attempt}/${maxAttempts}) for voice "${voiceName}" (${processedText.length} chars)`,
      send: () => this.requestSpeech(voiceName, stylePrompt, processedText),
    });
  }

  private async requestSpeech(voiceName: string, stylePrompt: string, processedText: string): Promise<Buffer> {
    const res = await postSpeechRequest(
      `${MIMO_BASE_URL}/chat/completions`,
      {
        "api-key": this.getApiKey(),
        "Content-Type": "application/json",
      },
      this.buildRequestBody(voiceName, stylePrompt, processedText),
      PROVIDER_LABEL,
    );

    const { json, readError } = await readResponseJson(res);
    if (!res.ok) {
      const apiMessage = json?.error?.message;
      throw new MiMoApiError(
        `MiMo TTS API error ${res.status}: ${apiMessage || readError?.message || res.statusText}`,
        res.status,
        parseRetryAfterMs(res.headers.get("retry-after")),
      );
    }
    if (readError) {
      throw new Error(`MiMo TTS returned an unreadable response: ${readError.message}`);
    }

    const audioData = json?.choices?.[0]?.message?.audio?.data;
    if (!audioData) {
      const apiMessage = json?.error?.message;
      throw new Error(`No audio payload returned from MiMo TTS API.${apiMessage ? ` API error: ${apiMessage}` : ""}`);
    }

    return ensureWavBuffer(Buffer.from(audioData, "base64"));
  }

  private buildRequestBody(voiceName: string, stylePrompt: string, processedText: string) {
    const isVoiceDesign = MIMO_TTS_MODEL === VOICEDESIGN_TS_MODEL;
    return {
      model: MIMO_TTS_MODEL,
      messages: [
        { role: "user", content: isVoiceDesign ? `${voiceName}, ${stylePrompt}` : stylePrompt },
        { role: "assistant", content: processedText },
      ],
      audio: isVoiceDesign ? { format: "wav" } : { format: "wav", voice: voiceName },
    };
  }

  private getApiKey(): string {
    const apiKey = process.env.MIMO_API_KEY;
    if (!apiKey) {
      throw new TtsConfigError("MIMO_API_KEY environment variable is not set.");
    }
    return apiKey;
  }
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

async function readResponseJson(res: Response): Promise<{ json: MiMoChatResponse | null; readError?: Error }> {
  if (!res.body) return { json: null };

  let buffer: Buffer;
  try {
    buffer = await readStreamWithCap(res.body, TTS_RESPONSE_CAP, () => new Error("MiMo TTS response exceeded the 64MB size limit."));
  } catch (err) {
    return { json: null, readError: err instanceof Error ? err : new Error(String(err)) };
  }

  try {
    return { json: JSON.parse(buffer.toString("utf-8")) as MiMoChatResponse };
  } catch {
    return { json: null, readError: new Error("MiMo TTS response was not valid JSON.") };
  }
}
