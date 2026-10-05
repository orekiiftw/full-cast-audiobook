import { isPendingStatus, isPlayableSegment } from "../../lib/segmentStatus";
import type { Segment } from "../../types/api";

export function findNextIndex(segments: Segment[], fromExclusive: number): number {
  let next = fromExclusive + 1;
  while (next < segments.length && segments[next].status === "failed") next += 1;
  return next < segments.length ? next : -1;
}

export function findPrevIndex(segments: Segment[], fromExclusive: number): number {
  let previous = fromExclusive - 1;
  while (previous >= 0 && segments[previous].status === "failed") previous -= 1;
  return previous;
}

export function hasPendingLines(segments: Segment[]): boolean {
  return segments.some((segment) => isPendingStatus(segment.status));
}

export function sumDurationsBefore(segments: Segment[], endExclusive: number): number {
  let total = 0;
  for (let index = 0; index < endExclusive; index++) {
    total += segments[index]?.durationMs ?? 0;
  }
  return total;
}

export function chapterDurationMs(segments: Segment[]): number {
  return segments.reduce((total, segment) => total + (segment.durationMs ?? 0), 0);
}

export function voicedSharePercent(segments: Segment[]): number {
  if (segments.length === 0) return 0;
  const voicedCount = segments.filter((segment) => segment.status === "voiced").length;
  return (voicedCount / segments.length) * 100;
}

export function playbackProgressPercent(positionMs: number, totalMs: number): number {
  if (totalMs <= 0) return 0;
  return Math.min(100, (positionMs / totalMs) * 100);
}

export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLSelectElement || target instanceof HTMLButtonElement) return true;
  return target instanceof HTMLElement && target.isContentEditable;
}

export function segmentSourceKey(segment: Segment, src: string): string {
  return `${segment.id}:${segment.durationMs ?? 0}:${src}`;
}

export function loadedSegmentId(loadedKey: string | null): string | null {
  return loadedKey?.split(":")[0] ?? null;
}

interface SeekPlan {
  index: number;
  offsetSec: number;
  positionMs: number;
  appliesInPlace: boolean;
}

export function resolveSeekPlan(segments: Segment[], currentIndex: number, ratio: number): SeekPlan | null {
  const total = chapterDurationMs(segments);
  if (total <= 0) return null;

  const targetMs = ratio * total;
  let accumulated = 0;
  for (let index = 0; index < segments.length; index++) {
    const duration = segments[index].durationMs ?? 0;
    if (duration <= 0) {
      if (index === segments.length - 1 && isPlayableSegment(segments[index])) {
        return { index, offsetSec: 0, positionMs: Math.round(targetMs), appliesInPlace: false };
      }
      continue;
    }
    if (accumulated + duration >= targetMs || index === segments.length - 1) {
      return {
        index,
        offsetSec: Math.max(0, (targetMs - accumulated) / 1000),
        positionMs: Math.round(targetMs),
        appliesInPlace: index === currentIndex,
      };
    }
    accumulated += duration;
  }
  return null;
}
