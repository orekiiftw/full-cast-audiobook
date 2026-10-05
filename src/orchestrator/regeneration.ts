import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { chapters, segments } from "../schema";
import { annotateSegment, extractBeats } from "../narration/annotation";
import { synthesizeSegmentAudio } from "../narration/voiceSegment";
import { getBookVoiceContext } from "../narration/voiceContext";
import { uploadFile } from "../storage/r2";
import { segmentAudioKey } from "../storage/keys";
import { acquireLock, releaseLock, emitProgressEvent, segmentJobId, segmentQueue } from "../queue";
import { restitchChapterInBackground } from "./index";
import { repairRegeneratedChapterCounters } from "./chapterCounters";
import { audioUrl, versionedAudioUrl } from "../lib/audioUrl";
import { isChapterComplete, type ChapterCounters } from "../lib/chapterStatus";

const REGENERATION_LOCK_TTL_MS = 5 * 60_000;

export interface RegenerationTarget {
  segmentId: string;
  segment: typeof segments.$inferSelect;
  chapter: typeof chapters.$inferSelect;
  bookId: string;
}

type RegenerationResult = { ok: true; audioUrl: string } | { ok: false; error: string };

export async function regenerateSegment(target: RegenerationTarget, instruction?: string): Promise<RegenerationResult> {
  const lockKey = `regen:${target.segmentId}`;
  const lockToken = await acquireLock(lockKey, REGENERATION_LOCK_TTL_MS);
  if (!lockToken) {
    return { ok: false, error: "This segment is already being regenerated. Please wait for it to finish." };
  }
  try {
    return await runRegeneration(target, instruction);
  } finally {
    await releaseLock(lockKey, lockToken);
  }
}

async function runRegeneration(target: RegenerationTarget, instruction?: string): Promise<RegenerationResult> {
  const { segmentId, segment, chapter, bookId } = target;

  await segmentQueue.remove(segmentJobId(segmentId)).catch(() => {});

  emitProgressEvent(bookId, "progress_log", {
    message: `Regenerating segment ${segment.segmentIndex}...`,
  });

  if (!(await claimSegment(segmentId))) {
    return { ok: false, error: "This segment is currently being processed. Try again shortly." };
  }

  const { wav, durationMs } = await synthesizeRegeneratedAudio(target, instruction);
  const audioR2Key = segmentAudioKey(bookId, chapter.chapterIndex, segment.segmentIndex);
  await uploadFile(audioR2Key, wav, "audio/wav");

  await db.update(segments).set({ audioR2Key, durationMs, status: "voiced" }).where(eq(segments.id, segmentId));

  const counters = await repairRegeneratedChapterCounters(chapter.id, segment.status);
  if (counters) {
    emitSegmentReady({ bookId, chapter, segment, audioR2Key, durationMs, counters });
  }

  if (chapter.status === "ready" || isChapterComplete(counters)) {
    restitchChapterInBackground(bookId, segment.chapterId, chapter.chapterIndex);
  }

  return { ok: true, audioUrl: audioUrl(audioR2Key) };
}

async function claimSegment(segmentId: string): Promise<boolean> {
  const claimed = await db
    .update(segments)
    .set({ status: "processing" })
    .where(and(eq(segments.id, segmentId), sql`${segments.status} != 'processing'`))
    .returning({ id: segments.id });
  return claimed.length > 0;
}

async function synthesizeRegeneratedAudio(target: RegenerationTarget, instruction?: string) {
  const { segment, bookId } = target;
  const { narratorVoice, narratorBaseStyle, pDict, language } = await getBookVoiceContext(bookId);
  const beats = await resolveRegenerationBeats(segment);

  return synthesizeSegmentAudio(beats, {
    narratorVoice,
    narratorBaseStyle,
    pDict,
    language,
    instruction,
    tempDirPrefix: "seg_regen_",
  });
}

async function resolveRegenerationBeats(segment: typeof segments.$inferSelect) {
  const beats = extractBeats(segment.annotatedJson);
  if (beats.length > 0) return beats;
  return (await annotateSegment(segment.rawText, [], "Regenerating scene.")).beats;
}

interface SegmentReadyPayload {
  bookId: string;
  chapter: typeof chapters.$inferSelect;
  segment: typeof segments.$inferSelect;
  audioR2Key: string;
  durationMs: number | null | undefined;
  counters: ChapterCounters;
}

function emitSegmentReady({ bookId, chapter, segment, audioR2Key, durationMs, counters }: SegmentReadyPayload): void {
  emitProgressEvent(bookId, "segment_ready", {
    chapterId: segment.chapterId,
    chapterIndex: chapter.chapterIndex,
    segmentId: segment.id,
    segmentIndex: segment.segmentIndex,
    audioR2Key,
    audioUrl: versionedAudioUrl(audioR2Key, durationMs),
    durationMs,
    done: counters.voicedCount,
    total: counters.totalCount,
    voicedCount: counters.voicedCount,
  });
}
