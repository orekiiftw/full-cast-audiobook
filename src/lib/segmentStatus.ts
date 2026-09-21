import type { Segment } from "../types/api";

export function isPendingStatus(status: Segment["status"]): boolean {
  return status === "pending" || status === "queued" || status === "processing" || status === "annotated";
}

export function isPlayableSegment(segment: Segment | undefined): boolean {
  return !!segment && segment.status === "voiced" && !!segment.audioUrl;
}
