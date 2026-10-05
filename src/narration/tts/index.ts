import { INDIC_LANGUAGES, normalizeLanguageCode, toBcp47 } from "../../lib/language";
import { MiMoTSProvider } from "./providers/mimo";
import { SarvamTSProvider } from "./providers/sarvam";
import type { TTSProvider } from "./types";

export { isRetryableError } from "./errors";

let sharedMimoProvider: MiMoTSProvider | null = null;

const sarvamProviders = new Map<string, SarvamTSProvider>();

export function getTTSProvider(language?: string | null): TTSProvider {
  if (selectProvider(language) === "sarvam") {
    const bcp47 = toBcp47(language) ?? "hi-IN";
    const existing = sarvamProviders.get(bcp47);
    if (existing) return existing;
    const provider = new SarvamTSProvider(bcp47);
    sarvamProviders.set(bcp47, provider);
    return provider;
  }

  sharedMimoProvider ??= new MiMoTSProvider();
  return sharedMimoProvider;
}

export function selectProvider(language?: string | null): "mimo" | "sarvam" {
  const forced = (process.env.TTS_PROVIDER ?? "").trim().toLowerCase();
  if (forced === "sarvam") return "sarvam";
  if (forced === "mimo") return "mimo";
  if (!process.env.SARVAM_API_KEY) return "mimo";
  const normalized = normalizeLanguageCode(language);
  return normalized && INDIC_LANGUAGES.has(normalized) ? "sarvam" : "mimo";
}
