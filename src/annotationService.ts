import { GoogleGenAI } from "@google/genai";
import { DEFAULT_TEXT_MODEL } from "./lib/constants";

const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || DEFAULT_TEXT_MODEL;

// The SDK client is stateless config; building it per segment (previously)
// re-parsed env and re-allocated its HTTP plumbing on every call.
let sharedClient: { apiKey: string; ai: GoogleGenAI } | null = null;

function geminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is not set.");
  }
  if (!sharedClient || sharedClient.apiKey !== apiKey) {
    sharedClient = { apiKey, ai: new GoogleGenAI({ apiKey }) };
  }
  return sharedClient.ai;
}

export interface BeatAnnotation {
  text: string;
  delivery: {
    style: string;
    emotion: string; // descriptive phrase, e.g. "voice trembling, trailing off"
    intensity: number; // 0.0 - 1.0
    pace: "slow" | "normal" | "fast";
  };
}

export interface AnnotationResult {
  scene_summary: string;
  beats: BeatAnnotation[];
}

/** Hard caps so a prompt-injected/buggy model can't emit unbounded fields. */
const MAX_BEATS = 12;
const MAX_BEAT_TEXT_CHARS = 4000;
const MAX_DELIVERY_FIELD_CHARS = 500;
const MAX_SCENE_SUMMARY_CHARS = 2000;
const VALID_PACE = new Set(["slow", "normal", "fast"]);

/** Plain delivery used when annotation fails or text alignment breaks. */
export const NEUTRAL_BEAT_DELIVERY = {
  style: "warm neutral storyteller",
  emotion: "steady narrative flow",
  intensity: 0.3,
  pace: "normal",
} as const;

export function createNeutralBeat(text: string): BeatAnnotation {
  return { text, delivery: { ...NEUTRAL_BEAT_DELIVERY } };
}

/**
 * Coerces arbitrary parsed JSON into a structurally-valid AnnotationResult.
 * Drops malformed beats, clamps out-of-range fields, and caps lengths so a
 * misbehaving/hallucinating LLM cannot push oversized strings into TTS.
 */
function normalizeAnnotation(parsed: unknown, fallbackText: string, fallbackSummary: string): AnnotationResult {
  const obj = parsed as Record<string, unknown> | null;
  if (!obj || typeof obj !== "object") {
    return { scene_summary: fallbackSummary, beats: [createNeutralBeat(fallbackText)] };
  }

  const rawSummary = typeof obj.scene_summary === "string" ? obj.scene_summary : fallbackSummary;
  const scene_summary = rawSummary.slice(0, MAX_SCENE_SUMMARY_CHARS) || fallbackSummary;

  const rawBeats = Array.isArray(obj.beats) ? obj.beats : [];
  const beats: BeatAnnotation[] = [];
  for (const b of rawBeats) {
    if (beats.length >= MAX_BEATS) break;
    if (!b || typeof b !== "object") continue;
    const beat = b as Record<string, unknown>;
    const text = typeof beat.text === "string" ? beat.text.slice(0, MAX_BEAT_TEXT_CHARS) : "";
    if (!text) continue;

    const deliverySrc = (beat.delivery && typeof beat.delivery === "object" ? beat.delivery : {}) as Record<string, unknown>;
    const style = typeof deliverySrc.style === "string" ? deliverySrc.style.slice(0, MAX_DELIVERY_FIELD_CHARS) : "warm neutral storyteller";
    const emotion = typeof deliverySrc.emotion === "string" ? deliverySrc.emotion.slice(0, MAX_DELIVERY_FIELD_CHARS) : "steady narrative flow";
    let intensity = typeof deliverySrc.intensity === "number" ? deliverySrc.intensity : 0.3;
    if (!Number.isFinite(intensity)) intensity = 0.3;
    intensity = Math.min(Math.max(intensity, 0), 1);
    const paceRaw = typeof deliverySrc.pace === "string" ? deliverySrc.pace : "normal";
    const pace = (VALID_PACE.has(paceRaw) ? paceRaw : "normal") as BeatAnnotation["delivery"]["pace"];

    beats.push({ text, delivery: { style, emotion, intensity, pace } });
  }

  if (beats.length === 0) {
    beats.push(createNeutralBeat(fallbackText));
  }

  return { scene_summary, beats };
}

/**
 * Extracts the beats array from a segment's annotatedJson column.
 * Supports both the legacy shape (bare beats array) and the current
 * shape ({ scene_summary, beats }). Legacy beats may carry a
 * speaker_cast_id field; it is ignored — all beats use the Narrator.
 * Always returns a normalized, length-bounded array.
 */
export function extractBeats(annotatedJson: unknown): BeatAnnotation[] {
  if (!annotatedJson) return [];
  if (Array.isArray(annotatedJson)) {
    return normalizeAnnotation({ beats: annotatedJson, scene_summary: "A scene in the book." }, "", "A scene in the book.").beats;
  }
  if (typeof annotatedJson === "object" && Array.isArray((annotatedJson as { beats?: unknown }).beats)) {
    return normalizeAnnotation(annotatedJson, "", "A scene in the book.").beats;
  }
  return [];
}

/**
 * Generates emotional beat annotations for a segment using Gemini.
 * Output is performance direction only (emotion/style/intensity/pace) —
 * the whole book is voiced by the single Narrator.
 */
export async function annotateSegment(
  currentText: string,
  prevSegments: string[],
  runningSummary: string
): Promise<AnnotationResult> {
  const ai = geminiClient();

  const prompt = `
You are an expert audiobook director annotating a script for a single-voice narrator recording.
You are given:
1. Current Segment Text: The text you must annotate.
2. Context: The previous two segments for narrative flow.
3. Running Scene Summary: A short summary of what has happened so far in this scene.

Your task is to:
1. Update the "Running Scene Summary" in 1 paragraph based on the current segment.
2. Segment the "Current Segment Text" into "beats" (sub-segments of text).
   CRITICAL RULE 1: The concatenated text of the beats MUST EXACTLY match the "Current Segment Text" byte-for-byte, character-for-character. Do not edit, add, or delete any characters, quotes, or punctuation from the input.
   CRITICAL RULE 2: Tag at BEAT level, not per sentence. Divide the segment into 1 to 4 beats maximum (typically 1 or 2). There should be at most one emotion shift per ~3 sentences.
   CRITICAL RULE 3: For delivery options:
     - "style" should describe the manner of speaking (e.g. "whispering", "boasting", "sarcastic", "matter-of-fact"). Default to "warm neutral storyteller" for plain narration; dialogue may be rendered with light character-appropriate inflection while keeping the narrator's voice.
     - "emotion" must be a short descriptive phrase (e.g. "voice trembling, trailing off", "suppressed chuckle", "rising anger", "calm and comforting"). NEVER use simple single-word labels like "happy", "sad", "angry".
     - "intensity" is a number between 0.0 (very passive/flat) and 1.0 (extreme emotion).
     - "pace" is "slow", "normal", or "fast".

Return the output in this exact JSON schema:
{
  "scene_summary": "Updated 1-paragraph summary of the scene.",
  "beats": [
    {
      "text": "The exact substring of text matching a part of the segment.",
      "delivery": {
        "style": "delivery style prompt",
        "emotion": "descriptive phrase for emotion",
        "intensity": 0.5,
        "pace": "normal"
      }
    }
  ]
}

Context (Previous 2 segments):
${prevSegments.map((s, idx) => `Segment ${idx + 1}: "${s}"`).join("\n")}

Running Scene Summary:
"${runningSummary}"

Current Segment Text to Annotate:
"${currentText}"
`;

  console.log(`🤖 Invoking Gemini annotation model for segment...`);
  const response = await ai.models.generateContent({
    model: GEMINI_TEXT_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
    },
  });

  const rawText = response.text;
  if (!rawText) {
    throw new Error("Empty response from annotation model.");
  }

  try {
    const parsed = JSON.parse(rawText) as unknown;
    const result = normalizeAnnotation(parsed, currentText, runningSummary);

    // Safety check: verify text matches the input segment
    const concatenatedBeats = result.beats.map((b) => b.text).join(" ").replace(/\s+/g, " ").trim();
    const cleanedInput = currentText.replace(/\s+/g, " ").trim();

    // If the text alignment fails, fall back to a single beat to ensure we do not lose content
    if (Math.abs(concatenatedBeats.length - cleanedInput.length) > 15) {
      console.warn("⚠️ Annotation text alignment warning. Falling back to single-beat mapping.");
      return {
        scene_summary: result.scene_summary || runningSummary,
        beats: [createNeutralBeat(currentText)],
      };
    }

    return result;
  } catch (err: any) {
    console.error("Annotation parse failed. Raw response length:", rawText.length);
    throw new Error(`Failed to parse annotation JSON response: ${err.message}`);
  }
}
