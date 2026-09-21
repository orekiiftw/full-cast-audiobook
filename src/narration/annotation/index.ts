import { createNeutralBeat, type AnnotationResult } from "./beats";
import { requestAnnotation } from "./gemini";
import { buildAnnotationPrompt } from "./prompt";
import { beatsMatchSegment, parseAnnotationResponse } from "./response";

export type { AnnotationResult, BeatAnnotation } from "./beats";
export { NEUTRAL_BEAT_DELIVERY, createNeutralBeat } from "./beats";
export { extractBeats } from "./response";

export async function annotateSegment(currentText: string, prevSegments: string[], runningSummary: string): Promise<AnnotationResult> {
  const rawResponse = await requestAnnotation(buildAnnotationPrompt(currentText, prevSegments, runningSummary));
  if (!rawResponse) {
    throw new Error("Empty response from annotation model.");
  }

  const result = parseAnnotationResponse(rawResponse, currentText, runningSummary);
  if (beatsMatchSegment(result.beats, currentText)) return result;

  console.warn("⚠️ Annotation text alignment warning. Falling back to single-beat mapping.");
  return {
    scene_summary: result.scene_summary || runningSummary,
    beats: [createNeutralBeat(currentText)],
  };
}
