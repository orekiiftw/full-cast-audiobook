interface IndicScript {
  code: string;
  label: string;
  start: number;
  end: number;
}

const INDIC_SCRIPTS: IndicScript[] = [
  { code: "hi", label: "Devanagari", start: 0x0900, end: 0x097f },
  { code: "hi", label: "Devanagari Extended", start: 0xa8e0, end: 0xa8ff },
  { code: "hi", label: "Vedic Extensions", start: 0x1cd0, end: 0x1cff },
  { code: "bn", label: "Bengali", start: 0x0980, end: 0x09ff },
  { code: "pa", label: "Gurmukhi", start: 0x0a00, end: 0x0a7f },
  { code: "gu", label: "Gujarati", start: 0x0a80, end: 0x0aff },
  { code: "or", label: "Odia", start: 0x0b00, end: 0x0b7f },
  { code: "ta", label: "Tamil", start: 0x0b80, end: 0x0bff },
  { code: "te", label: "Telugu", start: 0x0c00, end: 0x0c7f },
  { code: "kn", label: "Kannada", start: 0x0c80, end: 0x0cff },
  { code: "ml", label: "Malayalam", start: 0x0d00, end: 0x0d7f },
];

export const INDIC_LANGUAGES = new Set(["hi", "mr", "bn", "gu", "pa", "or", "ta", "te", "kn", "ml"]);

const INDIC_BCP47: Record<string, string> = {
  hi: "hi-IN",
  mr: "mr-IN",
  bn: "bn-IN",
  gu: "gu-IN",
  pa: "pa-IN",
  or: "od-IN",
  ta: "ta-IN",
  te: "te-IN",
  kn: "kn-IN",
  ml: "ml-IN",
  en: "en-IN",
};

const LANGUAGE_ALIASES: Record<string, string> = {
  hin: "hi",
  ben: "bn",
  pan: "pa",
  guj: "gu",
  ori: "or",
  tam: "ta",
  tel: "te",
  kan: "kn",
  mal: "ml",
  mar: "mr",
  eng: "en",
};

const INDIC_SHARE_THRESHOLD = 0.3;

export function normalizeLanguageCode(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  const primary = trimmed.split(/[-_]/)[0];
  return LANGUAGE_ALIASES[primary] ?? primary;
}

export function toBcp47(language: string | null | undefined): string | null {
  const normalized = normalizeLanguageCode(language);
  if (!normalized) return null;
  return INDIC_BCP47[normalized] ?? null;
}

export function detectIndicLanguage(text: string): string | null {
  const { counts, indicChars, visibleChars } = tallyIndicChars(text);
  if (indicChars === 0 || visibleChars === 0) return null;
  if (indicChars / visibleChars < INDIC_SHARE_THRESHOLD) return null;
  return dominantScriptCode(counts);
}

interface IndicTally {
  counts: Map<string, number>;
  indicChars: number;
  visibleChars: number;
}

function tallyIndicChars(text: string): IndicTally {
  const counts = new Map<string, number>();
  let indicChars = 0;
  let visibleChars = 0;

  for (const char of text) {
    if (/\s/.test(char)) continue;
    visibleChars += 1;

    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) continue;

    const script = INDIC_SCRIPTS.find((candidate) => codePoint >= candidate.start && codePoint <= candidate.end);
    if (!script) continue;

    counts.set(script.code, (counts.get(script.code) ?? 0) + 1);
    indicChars += 1;
  }

  return { counts, indicChars, visibleChars };
}

function dominantScriptCode(counts: Map<string, number>): string | null {
  let dominantCode: string | null = null;
  let dominantCount = 0;
  for (const [code, count] of counts) {
    if (count > dominantCount) {
      dominantCode = code;
      dominantCount = count;
    }
  }
  return dominantCode;
}
