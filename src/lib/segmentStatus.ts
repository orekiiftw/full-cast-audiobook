import type { Segment } from "../types/api";

export function isPendingStatus(status: Segment["status"]): boolean {
  return status === "pending" || status === "queued" || status === "processing" || status === "annotated";
}

export function isPlayableSegment(seg: Segment | undefined): boolean {
  return !!seg && seg.status === "voiced" && !!seg.audioUrl;
}
