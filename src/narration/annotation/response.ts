import { NEUTRAL_BEAT_DELIVERY, createNeutralBeat, type AnnotationResult, type BeatAnnotation } from "./beats";

const MAX_BEATS = 12;
const MAX_BEAT_TEXT_CHARS = 4000;
const MAX_DELIVERY_FIELD_CHARS = 500;
const MAX_SCENE_SUMMARY_CHARS = 2000;
const VALID_PACE = new Set(["slow", "normal", "fast"]);
const LEGACY_SCENE_SUMMARY = "A scene in the book.";

export function extractBeats(annotatedJson: unknown): BeatAnnotation[] {
  if (!annotatedJson) return [];
  if (Array.isArray(annotatedJson)) {
    return normalizeAnnotation({ beats: annotatedJson, scene_summary: LEGACY_SCENE_SUMMARY }, "", LEGACY_SCENE_SUMMARY).beats;
  }
  if (typeof annotatedJson === "object" && Array.isArray((annotatedJson as { beats?: unknown }).beats)) {
    return normalizeAnnotation(annotatedJson, "", LEGACY_SCENE_SUMMARY).beats;
  }
  return [];
}

export function parseAnnotationResponse(raw: string, fallbackText: string, fallbackSummary: string): AnnotationResult {
  try {
    return normalizeAnnotation(JSON.parse(raw) as unknown, fallbackText, fallbackSummary);
  } catch (error) {
    console.error("Annotation parse failed. Raw response length:", raw.length);
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse annotation JSON response: ${detail}`);
  }
}

export function beatsMatchSegment(beats: BeatAnnotation[], segmentText: string): boolean {
  const voicedCore = coreText(
    beats
      .map((beat) => beat.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim(),
  );
  return voicedCore === coreText(segmentText.replace(/\s+/g, " ").trim());
}

function coreText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeAnnotation(parsed: unknown, fallbackText: string, fallbackSummary: string): AnnotationResult {
  const source = parsed as Record<string, unknown> | null;
  if (!source || typeof source !== "object") {
    return { scene_summary: fallbackSummary, beats: [createNeutralBeat(fallbackText)] };
  }

  return {
    scene_summary: sanitizeSceneSummary(source.scene_summary, fallbackSummary),
    beats: normalizeBeats(source.beats, fallbackText),
  };
}

function sanitizeSceneSummary(value: unknown, fallbackSummary: string): string {
  const raw = typeof value === "string" ? value : fallbackSummary;
  const sanitized = raw
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/\b(ignore previous|system:|assistant:|user:|<\/?system>)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized.slice(0, MAX_SCENE_SUMMARY_CHARS) || fallbackSummary;
}

function normalizeBeats(rawBeats: unknown, fallbackText: string): BeatAnnotation[] {
  const beats: BeatAnnotation[] = [];
  for (const candidate of Array.isArray(rawBeats) ? rawBeats : []) {
    if (beats.length >= MAX_BEATS) break;
    const beat = normalizeBeat(candidate);
    if (beat) beats.push(beat);
  }
  return beats.length > 0 ? beats : [createNeutralBeat(fallbackText)];
}

function normalizeBeat(candidate: unknown): BeatAnnotation | null {
  if (!candidate || typeof candidate !== "object") return null;

  const beat = candidate as Record<string, unknown>;
  const text = typeof beat.text === "string" ? beat.text.slice(0, MAX_BEAT_TEXT_CHARS) : "";
  if (!text) return null;

  const delivery = (beat.delivery && typeof beat.delivery === "object" ? beat.delivery : {}) as Record<string, unknown>;
  return {
    text,
    delivery: {
      style: boundedText(delivery.style, NEUTRAL_BEAT_DELIVERY.style),
      emotion: boundedText(delivery.emotion, NEUTRAL_BEAT_DELIVERY.emotion),
      intensity: normalizeIntensity(delivery.intensity),
      pace: normalizePace(delivery.pace),
    },
  };
}

function boundedText(value: unknown, fallback: string): string {
  return typeof value === "string" ? value.slice(0, MAX_DELIVERY_FIELD_CHARS) : fallback;
}

function normalizeIntensity(value: unknown): number {
  const base = typeof value === "number" && Number.isFinite(value) ? value : NEUTRAL_BEAT_DELIVERY.intensity;
  return Math.min(Math.max(base, 0), 1);
}

function normalizePace(value: unknown): BeatAnnotation["delivery"]["pace"] {
  const candidate = typeof value === "string" ? value : NEUTRAL_BEAT_DELIVERY.pace;
  return (VALID_PACE.has(candidate) ? candidate : NEUTRAL_BEAT_DELIVERY.pace) as BeatAnnotation["delivery"]["pace"];
}
