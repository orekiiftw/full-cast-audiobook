export interface BeatAnnotation {
  text: string;
  delivery: {
    style: string;
    emotion: string;
    intensity: number;
    pace: "slow" | "normal" | "fast";
  };
}

export interface AnnotationResult {
  scene_summary: string;
  beats: BeatAnnotation[];
}

export const NEUTRAL_BEAT_DELIVERY = {
  style: "warm neutral storyteller",
  emotion: "steady narrative flow",
  intensity: 0.3,
  pace: "normal",
} as const;

export function createNeutralBeat(text: string): BeatAnnotation {
  return { text, delivery: { ...NEUTRAL_BEAT_DELIVERY } };
}
