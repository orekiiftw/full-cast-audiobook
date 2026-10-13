import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { chapters, segments } from "../schema";
import { annotateSegment, extractBeats } from "../narration/annotation";
import { synthesizeSegmentAudio } from "../narration/voiceSegment";
import { getBookVoiceContext } from "../narration/voiceContext";
import { uploadFile } from "../storage/r2";
import { segmentAudioKey } from "../storage/keys";
import { acquireLock, isLockHeld, releaseLock, emitProgressEvent, segmentJobId, segmentQueue } from "../queue";
import { restitchChapterInBackground } from "./index";
import { repairRegeneratedChapterCounters } from "./chapterCounters";
import { audioUrl, versionedAudioUrl } from "../lib/audioUrl";
import { isChapterComplete, type ChapterCounters } from "../lib/chapterStatus";

const REGENERATION_LOCK_TTL_MS = 5 * 60_000;

const REGENERATION_COOLDOWN_MS = 15_000;

type SegmentRow = typeof segments.$inferSelect;

type SegmentStatus = SegmentRow["status"];

// processing and annotated rows are mid-flight in a segment worker, which owns them until it finishes.
const CLAIMABLE_STATUSES = new Set<SegmentStatus>(["pending", "queued", "failed", "voiced"]);

export interface RegenerationTarget {
  segmentId: string;
  segment: SegmentRow;
  chapter: typeof chapters.$inferSelect;
  bookId: string;
}

type RegenerationResult = { ok: true; audioUrl: string } | { ok: false; reason: "busy" | "cooldown"; error: string };

const SEGMENT_BUSY: RegenerationResult = {
  ok: false,
  reason: "busy",
  error: "This segment is currently being processed. Try again shortly.",
};

export async function regenerateSegment(target: RegenerationTarget, instruction?: string): Promise<RegenerationResult> {
  const lockKey = `regen:${target.segmentId}`;
  const lockToken = await acquireLock(lockKey, REGENERATION_LOCK_TTL_MS);
  if (!lockToken) {
    return { ok: false, reason: "busy", error: "This segment is already being regenerated. Please wait for it to finish." };
  }
  try {
    const cooldownKey = `regen-cooldown:${target.segmentId}`;
    if (await isLockHeld(cooldownKey)) {
      return { ok: false, reason: "cooldown", error: "This line was just regenerated. Wait a few seconds before trying again." };
    }
    const result = await runRegeneration(target, instruction);
    if (result.ok) await startCooldown(cooldownKey);
    return result;
  } finally {
    await releaseLock(lockKey, lockToken);
  }
}

async function startCooldown(cooldownKey: string): Promise<void> {
  await acquireLock(cooldownKey, REGENERATION_COOLDOWN_MS).catch((err) =>
    console.warn("⚠️ Failed to start the regeneration cooldown:", err.message),
  );
}

async function runRegeneration(target: RegenerationTarget, instruction?: string): Promise<RegenerationResult> {
  const { segmentId, segment, chapter, bookId } = target;
  if (!CLAIMABLE_STATUSES.has(segment.status)) return SEGMENT_BUSY;

  await segmentQueue.remove(segmentJobId(segmentId)).catch(() => {});

  emitProgressEvent(bookId, "progress_log", {
    message: `Regenerating segment ${segment.segmentIndex}...`,
  });

  const claimedStatus = await claimSegment(segmentId, segment.status);
  if (!claimedStatus) return SEGMENT_BUSY;

  const audioR2Key = segmentAudioKey(bookId, chapter.chapterIndex, segment.segmentIndex);
  let durationMs: number | null;
  try {
    durationMs = await replaceSegmentAudio(target, claimedStatus, audioR2Key, instruction);
  } catch (error) {
    await releaseClaim(segmentId, claimedStatus, segment.status);
    throw error;
  }
  if (durationMs === null) return SEGMENT_BUSY;

  const counters = await repairRegeneratedChapterCounters(chapter.id, segment.status);
  if (counters) {
    emitSegmentReady({ bookId, chapter, segment, audioR2Key, durationMs, counters });
  }

  if (chapter.status === "ready" || isChapterComplete(counters)) {
    restitchChapterInBackground(bookId, segment.chapterId, chapter.chapterIndex);
  }

  return { ok: true, audioUrl: audioUrl(audioR2Key) };
}

// A voiced line keeps its status while it is re-performed, so it stays playable and the sweep never
// requeues it as orphaned work for the worker to voice and count a second time.
async function claimSegment(segmentId: string, previousStatus: SegmentStatus): Promise<SegmentStatus | null> {
  const claimedStatus: SegmentStatus = previousStatus === "voiced" ? "voiced" : "processing";
  const claimed = await db
    .update(segments)
    .set({ status: claimedStatus })
    .where(and(eq(segments.id, segmentId), eq(segments.status, previousStatus)))
    .returning({ id: segments.id });
  return claimed.length > 0 ? claimedStatus : null;
}

async function replaceSegmentAudio(
  target: RegenerationTarget,
  claimedStatus: SegmentStatus,
  audioR2Key: string,
  instruction?: string,
): Promise<number | null> {
  const { wav, durationMs } = await synthesizeRegeneratedAudio(target, instruction);
  await uploadFile(audioR2Key, wav, "audio/wav");

  const published = await db
    .update(segments)
    .set({ audioR2Key, durationMs, status: "voiced" })
    .where(and(eq(segments.id, target.segmentId), eq(segments.status, claimedStatus)))
    .returning({ id: segments.id });
  return published.length > 0 ? durationMs : null;
}

async function releaseClaim(segmentId: string, claimedStatus: SegmentStatus, previousStatus: SegmentStatus): Promise<void> {
  if (claimedStatus !== "processing") return;
  await db
    .update(segments)
    .set({ status: previousStatus })
    .where(and(eq(segments.id, segmentId), eq(segments.status, "processing")))
    .catch((err) => console.error(`Failed to restore segment ${segmentId} to ${previousStatus} after a failed regeneration:`, err));
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

async function resolveRegenerationBeats(segment: SegmentRow) {
  const beats = extractBeats(segment.annotatedJson);
  if (beats.length > 0) return beats;
  return (await annotateSegment(segment.rawText, [], "Regenerating scene.")).beats;
}

interface SegmentReadyPayload {
  bookId: string;
  chapter: typeof chapters.$inferSelect;
  segment: SegmentRow;
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
