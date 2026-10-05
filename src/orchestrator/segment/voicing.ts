import type { Job } from "bullmq";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { chapters, segments } from "../../schema";
import { uploadFile } from "../../storage/r2";
import { segmentAudioKey } from "../../storage/keys";
import { synthesizeSegmentAudio } from "../../narration/voiceSegment";
import { getBookVoiceContext } from "../../narration/voiceContext";
import { emitProgressEvent, enqueueStitch, type SegmentJobData } from "../../queue";
import { incrementVoicedCount } from "../chapterCounters";
import { isChapterComplete, type ChapterCounters } from "../../lib/chapterStatus";
import { versionedAudioUrl } from "../../lib/audioUrl";
import { loadSegmentBeats } from "./annotation";
import { markChapterProcessing, maybeMarkPartialReady } from "./progress";

type ChapterRow = typeof chapters.$inferSelect;

type SegmentRow = typeof segments.$inferSelect;

export async function voiceSegment(job: Job<SegmentJobData>, segmentRow: SegmentRow, chapterRow: ChapterRow): Promise<void> {
  const { bookId, chapterId } = job.data;
  const chapterIndex = chapterRow.chapterIndex;

  const { narratorId, narratorVoice, narratorBaseStyle, pDict, language } = await getBookVoiceContext(bookId);

  await markChapterProcessing(bookId, chapterRow);

  const beats = await loadSegmentBeats(chapterId, segmentRow, narratorId);

  console.log(`🎙️ Voicing segment ${segmentRow.segmentIndex} (contains ${beats.length} beats)`);

  const { wav: finalBytes, durationMs } = await synthesizeSegmentAudio(beats, {
    narratorVoice,
    narratorBaseStyle,
    pDict,
    language,
    tempDirPrefix: "seg_tts_",
    onBeatStart: (index, total) => {
      emitProgressEvent(bookId, "progress_log", {
        message: `Synthesizing segment ${segmentRow.segmentIndex}, part ${index + 1} of ${total}...`,
      });
    },
  });

  const audioR2Key = segmentAudioKey(bookId, chapterIndex, segmentRow.segmentIndex);
  await uploadFile(audioR2Key, finalBytes, "audio/wav");

  const counters = await publishVoicedSegment(job, segmentRow, chapterRow, audioR2Key, durationMs);
  if (!counters) return;

  await maybeMarkPartialReady(bookId, chapterId, chapterIndex, chapterRow.status, counters);

  if (isChapterComplete(counters)) {
    await enqueueStitch({ bookId, chapterId, chapterIndex });
  }
}

async function publishVoicedSegment(
  job: Job<SegmentJobData>,
  segmentRow: SegmentRow,
  chapterRow: ChapterRow,
  audioR2Key: string,
  durationMs: number,
): Promise<ChapterCounters | undefined> {
  const { bookId, chapterId, segmentId } = job.data;

  const counters = await markSegmentVoiced(segmentId, chapterId, audioR2Key, durationMs);
  if (!counters) return undefined;

  const chapterIndex = chapterRow.chapterIndex;
  emitProgressEvent(bookId, "segment_ready", {
    chapterId,
    chapterIndex,
    segmentId,
    segmentIndex: segmentRow.segmentIndex,
    audioR2Key,
    audioUrl: versionedAudioUrl(audioR2Key, durationMs),
    durationMs,
    done: counters.voicedCount,
    total: counters.totalCount,
    voicedCount: counters.voicedCount,
  });

  return counters;
}

async function markSegmentVoiced(
  segmentId: string,
  chapterId: string,
  audioR2Key: string,
  durationMs: number,
): Promise<ChapterCounters | undefined> {
  const voicedRows = await db
    .update(segments)
    .set({
      audioR2Key,
      durationMs,
      status: "voiced",
    })
    .where(and(eq(segments.id, segmentId), sql`${segments.status} != 'voiced'`))
    .returning({ id: segments.id });
  if (voicedRows.length === 0) {
    console.warn(`⚠️ Segment ${segmentId} was already voiced by a duplicate execution — skipping counter update.`);
    return undefined;
  }

  return (await incrementVoicedCount(chapterId)) ?? { voicedCount: 0, failedCount: 0, totalCount: 0 };
}
