import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { chapters, segments } from "../../schema";
import { annotateSegment, extractBeats } from "../../narration/annotation";
import { synthesizeSegmentAudio } from "../../narration/voiceSegment";
import { getBookVoiceContext } from "../../narration/voiceContext";
import { uploadFile } from "../../storage/r2";
import { emitProgressEvent, segmentJobId, segmentQueue } from "../../queue";
import { restitchChapterInBackground } from "../../orchestrator";
import { firstRow } from "../../lib/query";
import { json } from "../response";

export interface RegenerationTarget {
  segmentId: string;
  segment: typeof segments.$inferSelect;
  chapter: typeof chapters.$inferSelect;
  bookId: string;
}

interface ChapterCounters {
  voicedCount: number;
  failedCount: number;
  totalCount: number;
}

export async function runRegeneration(target: RegenerationTarget, instruction?: string): Promise<Response> {
  const { segmentId, segment, chapter, bookId } = target;

  await segmentQueue.remove(segmentJobId(segmentId)).catch(() => {});

  emitProgressEvent(bookId, "progress_log", {
    message: `Regenerating segment ${segment.segmentIndex}...`,
  });

  if (!(await claimSegment(segmentId))) {
    return json({ error: "This segment is currently being processed. Try again shortly." }, 409);
  }

  const { wav, durationMs } = await synthesizeRegeneratedAudio(target, instruction);
  const audioR2Key = `books/${bookId}/chapters/ch_${chapter.chapterIndex}/segment_${segment.segmentIndex}.wav`;
  await uploadFile(audioR2Key, wav, "audio/wav");

  await db.update(segments).set({ audioR2Key, durationMs, status: "voiced" }).where(eq(segments.id, segmentId));

  const counters = await applyChapterCounterDelta(chapter.id, segment.status);
  if (counters) {
    emitSegmentReady({ bookId, chapter, segment, audioR2Key, durationMs, counters });
  }

  if (chapter.status === "ready" || isChapterComplete(counters)) {
    restitchChapterInBackground(bookId, segment.chapterId, chapter.chapterIndex);
  }

  return json({
    success: true,
    audioUrl: `/api/audio?key=${encodeURIComponent(audioR2Key)}`,
  });
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

async function applyChapterCounterDelta(chapterId: string, previousStatus: string): Promise<ChapterCounters | undefined> {
  const columns = {
    voicedCount: chapters.voicedCount,
    failedCount: chapters.failedCount,
    totalCount: chapters.totalCount,
  };

  if (previousStatus === "failed") {
    return firstRow(
      db
        .update(chapters)
        .set({
          voicedCount: sql`${chapters.voicedCount} + 1`,
          failedCount: sql`GREATEST(${chapters.failedCount} - 1, 0)`,
        })
        .where(eq(chapters.id, chapterId))
        .returning(columns),
    );
  }

  if (previousStatus === "voiced") {
    return firstRow(db.select(columns).from(chapters).where(eq(chapters.id, chapterId)));
  }

  return firstRow(
    db
      .update(chapters)
      .set({ voicedCount: sql`${chapters.voicedCount} + 1` })
      .where(eq(chapters.id, chapterId))
      .returning(columns),
  );
}

function isChapterComplete(counters: ChapterCounters | undefined): boolean {
  return !!counters && counters.totalCount > 0 && counters.voicedCount + counters.failedCount >= counters.totalCount;
}

function emitSegmentReady({ bookId, chapter, segment, audioR2Key, durationMs, counters }: SegmentReadyPayload): void {
  emitProgressEvent(bookId, "segment_ready", {
    chapterId: segment.chapterId,
    chapterIndex: chapter.chapterIndex,
    segmentId: segment.id,
    segmentIndex: segment.segmentIndex,
    audioR2Key,
    audioUrl: `/api/audio?key=${encodeURIComponent(audioR2Key)}&v=${durationMs ?? 0}`,
    durationMs,
    done: counters.voicedCount,
    total: counters.totalCount,
    voicedCount: counters.voicedCount,
  });
}

interface SegmentReadyPayload {
  bookId: string;
  chapter: typeof chapters.$inferSelect;
  segment: typeof segments.$inferSelect;
  audioR2Key: string;
  durationMs: number | null | undefined;
  counters: ChapterCounters;
}
