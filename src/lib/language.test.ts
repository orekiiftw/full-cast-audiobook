import { describe, expect, it } from "bun:test";
import { detectIndicLanguage, normalizeLanguageCode, toBcp47, INDIC_LANGUAGES } from "./language";
import { selectProvider } from "../narration/tts";

const HINDI_PROSE = "राम ने अपनी माँ से कहा कि वह कल सुबह गाँव जाएगा और वहाँ से खेत के लिए बीज लेकर आएगा। माँ ने कोई जवाब नहीं दिया।";

describe("detectIndicLanguage", () => {
  it("detects the script of Indic prose", () => {
    expect(detectIndicLanguage(HINDI_PROSE)).toBe("hi");
    expect(detectIndicLanguage("এটি একটি বাংলা বাক্য। আরও কিছু লেখা এখানে আছে।")).toBe("bn");
    expect(detectIndicLanguage("இது ஒரு தமிழ் வாக்கியம். மேலும் சில சொற்கள்.")).toBe("ta");
    expect(detectIndicLanguage("ಇದು ಕನ್ನಡ ವಾಕ್ಯ. ಇನ್ನೂ ಕೆಲವು ಪದಗಳು.")).toBe("kn");
  });

  it("returns null for Latin-script text", () => {
    expect(detectIndicLanguage("This is an English sentence.")).toBeNull();
    expect(detectIndicLanguage("")).toBeNull();
  });

  it("does not flip an English book that quotes a few Devanagari words", () => {
    const mixed =
      "The old scholar paused, then said शब्द quietly, and returned to his English lecture about the " +
      "history of colonial printing presses across the northern provinces of the subcontinent.";
    expect(detectIndicLanguage(mixed)).toBeNull();
  });

  it("still detects a heavily code-mixed Hindi passage", () => {
    const codeMixed = "राम ने कहा कि यह project बहुत अच्छा है और हमें इसे जल्दी finish करना चाहिए।";
    expect(detectIndicLanguage(codeMixed)).toBe("hi");
  });
});

describe("normalizeLanguageCode", () => {
  it("maps MARC/ISO-639-2 codes that catalogue providers emit", () => {
    expect(normalizeLanguageCode("hin")).toBe("hi");
    expect(normalizeLanguageCode("ben")).toBe("bn");
    expect(normalizeLanguageCode("eng")).toBe("en");
  });

  it("strips regional subtags and case", () => {
    expect(normalizeLanguageCode("HI-IN")).toBe("hi");
    expect(normalizeLanguageCode("  Hi  ")).toBe("hi");
    expect(normalizeLanguageCode(null)).toBeNull();
    expect(normalizeLanguageCode("")).toBeNull();
  });
});

describe("toBcp47", () => {
  it("maps detected codes to the BCP-47 tags the Sarvam API requires", () => {
    expect(toBcp47("hi")).toBe("hi-IN");
    expect(toBcp47("gu")).toBe("gu-IN");
    expect(toBcp47("or")).toBe("od-IN");
    expect(toBcp47("ta")).toBe("ta-IN");
  });

  it("accepts MARC forms and regional subtags", () => {
    expect(toBcp47("hin")).toBe("hi-IN");
    expect(toBcp47("HI-IN")).toBe("hi-IN");
  });

  it("returns null for languages the provider does not serve", () => {
    expect(toBcp47("de")).toBeNull();
    expect(toBcp47(null)).toBeNull();
  });
});

describe("selectProvider", () => {
  process.env.SARVAM_API_KEY = process.env.SARVAM_API_KEY || "test-key";
  delete process.env.TTS_PROVIDER;

  it("routes every language the Sarvam API accepts to Sarvam", () => {
    for (const code of INDIC_LANGUAGES) {
      expect(selectProvider(code)).toBe("sarvam");
    }
  });

  it("keeps English and unknown books on MiMo", () => {
    expect(selectProvider("en")).toBe("mimo");
    expect(selectProvider(null)).toBe("mimo");
    expect(selectProvider(undefined)).toBe("mimo");
  });

  it("accepts MARC forms from provider metadata", () => {
    expect(selectProvider("hin")).toBe("sarvam");
    expect(selectProvider("eng")).toBe("mimo");
  });

  it("falls back to MiMo when no Sarvam key is configured", () => {
    const saved = process.env.SARVAM_API_KEY;
    delete process.env.SARVAM_API_KEY;
    try {
      expect(selectProvider("hi")).toBe("mimo");
    } finally {
      process.env.SARVAM_API_KEY = saved;
    }
  });

  it("honours an explicit TTS_PROVIDER override", () => {
    try {
      process.env.TTS_PROVIDER = "sarvam";
      expect(selectProvider("en")).toBe("sarvam");
      process.env.TTS_PROVIDER = "mimo";
      expect(selectProvider("hi")).toBe("mimo");
    } finally {
      delete process.env.TTS_PROVIDER;
    }
  });
});
