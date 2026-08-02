import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { chapters, segments } from "../../schema";
import { annotateSegment, extractBeats } from "../../annotationService";
import { uploadFile } from "../../r2";
import { emitProgressEvent, restitchChapterInBackground } from "../../orchestrator";
import { acquireLock, releaseLock, segmentQueue, segmentJobId } from "../../queue";
import { synthesizeSegmentAudio } from "../../lib/voiceSegment";
import { getBookVoiceContext } from "../../lib/bookCache";
import { json } from "../response";
import { readJsonWithLimit, optionalString, requireUuid, ValidationError } from "../../lib/validators";
import { AuthUser } from "../../auth";
import { ownedSegment } from "../ownership";

const REGEN_RE = /^\/api\/segments\/([a-f0-9-]+)\/regenerate$/i;
const MAX_INSTRUCTION_LENGTH = 500;

/**
 * Regeneration guard: a distributed Redis lock (multi-instance safe, replacing
 * the old per-process Set). Regeneration is expensive (TTS + R2 upload +
 * re-stitch); two simultaneous requests would double the cost and race on
 * last-write-wins. The TTL is the backstop for a holder that dies mid-regen.
 */
const REGEN_LOCK_TTL_MS = 5 * 60_000;

export async function registerSegmentRoutes(req: Request, path: string, user: AuthUser): Promise<Response | null> {
  // ----------------------------------------------------
  // POST /api/segments/:id/regenerate
  // ----------------------------------------------------
  const regenMatch = path.match(REGEN_RE);
  if (!regenMatch || req.method !== "POST") {
    return null;
  }

  const segmentId = requireUuid(regenMatch[1], "segmentId");
  const body = (await readJsonWithLimit(req)) as Record<string, unknown>;
  const instruction = optionalString(body, "instruction");
  if (instruction && instruction.length > MAX_INSTRUCTION_LENGTH) {
    throw new ValidationError(`instruction must be ${MAX_INSTRUCTION_LENGTH} characters or fewer`);
  }

  const owned = await ownedSegment(user.id, segmentId);
  const segmentData = owned?.segment;
  const chapterData = owned?.chapter;
  if (!segmentData || !chapterData) {
    return json({ error: "Segment not found" }, 404);
  }
  const bookId = chapterData.bookId;

  // Block a duplicate regeneration already in flight (on any instance).
  const lockToken = await acquireLock(`regen:${segmentId}`, REGEN_LOCK_TTL_MS);
  if (!lockToken) {
    return json({ error: "This segment is already being regenerated. Please wait for it to finish." }, 409);
  }
  try {
    // Cancel any pending/delayed pipeline job for this segment so a delayed
    // BullMQ retry cannot fire, reset the row from "processing" back to
    // "queued" (segment.ts:47-52), and re-claim it — racing the regeneration
    // and double-spending on TTS. Active jobs are locked but will no-op at
    // their own claim (status is "processing", not "queued").
    await segmentQueue.remove(segmentJobId(segmentId)).catch(() => {});

    emitProgressEvent(bookId, "progress_log", {
      message: `Regenerating segment ${segmentData.segmentIndex}...`,
    });

    // Atomically claim the segment before any paid synthesis. The Redis lock
    // only guards regen-vs-regen; without this DB transition, a queued
    // pipeline worker can claim and voice the same segment concurrently
    // (duplicate TTS spend, last-write-wins audio).
    const claimed = await db
      .update(segments)
      .set({ status: "processing" })
      .where(and(eq(segments.id, segmentId), sql`${segments.status} != 'processing'`))
      .returning({ id: segments.id });
    if (claimed.length === 0) {
      return json({ error: "This segment is currently being processed. Try again shortly." }, 409);
    }

    // Narrator + pronunciation dict from the per-book cache (per-book invariants)
    const { narratorVoice, narratorBaseStyle, pDict } = await getBookVoiceContext(bookId);

    let beats = extractBeats(segmentData.annotatedJson);
    if (beats.length === 0) {
      const annotationRes = await annotateSegment(
        segmentData.rawText,
        [],
        "Regenerating scene."
      );
      beats = annotationRes.beats;
    }

    // Beats synthesize concurrently and merge in memory (ffmpeg fallback inside)
    const { wav: finalBytes, durationMs } = await synthesizeSegmentAudio(beats, {
      narratorVoice,
      narratorBaseStyle,
      pDict,
      instruction,
      tempDirPrefix: "seg_regen_",
    });

    const segmentR2Key = `books/${bookId}/chapters/ch_${chapterData.chapterIndex}/segment_${segmentData.segmentIndex}.wav`;
    await uploadFile(segmentR2Key, finalBytes, "audio/wav");

    await db
      .update(segments)
      .set({
        audioR2Key: segmentR2Key,
        durationMs,
        status: "voiced",
      })
      .where(eq(segments.id, segmentId));

    // Keep chapter terminal counters consistent: a regenerated FAILED segment
    // moves failed→voiced. Anything else (re-voicing an already-voiced line)
    // leaves counters unchanged. Read the status captured BEFORE our claim
    // transitioned the row to "processing".
    const counters = segmentData.status === "failed"
      ? await db
          .update(chapters)
          .set({
            voicedCount: sql`${chapters.voicedCount} + 1`,
            failedCount: sql`GREATEST(${chapters.failedCount} - 1, 0)`,
          })
          .where(eq(chapters.id, chapterData.id))
          .returning({
            voicedCount: chapters.voicedCount,
            failedCount: chapters.failedCount,
            totalCount: chapters.totalCount,
          })
          .then((rows) => rows[0])
      : await db
          .select({
            voicedCount: chapters.voicedCount,
            failedCount: chapters.failedCount,
            totalCount: chapters.totalCount,
          })
          .from(chapters)
          .where(eq(chapters.id, chapterData.id))
          .then((rows) => rows[0]);

    if (counters) {
      emitProgressEvent(bookId, "segment_ready", {
        chapterId: segmentData.chapterId,
        chapterIndex: chapterData.chapterIndex,
        segmentId,
        segmentIndex: segmentData.segmentIndex,
        audioR2Key: segmentR2Key,
        done: counters.voicedCount,
        total: counters.totalCount,
        voicedCount: counters.voicedCount,
      });
    }

    if (
      chapterData.status === "ready" ||
      (counters &&
        counters.totalCount > 0 &&
        counters.voicedCount + counters.failedCount >= counters.totalCount)
    ) {
      // Re-stitch via the durable queue: the stitch:{chapterId} jobId guard
      // prevents overlap with a pipeline stitch on any instance, and the
      // processor re-validates chapter state before doing any work — covering
      // both "already stitched" and "regenerated line completed the chapter".
      restitchChapterInBackground(bookId, segmentData.chapterId, chapterData.chapterIndex);
    }

    return json({
      success: true,
      audioUrl: `/api/audio?key=${encodeURIComponent(segmentR2Key)}`,
    });
  } finally {
    // Always release the regeneration guard, whether the request succeeded,
    // failed, or threw before creating the work directory.
    await releaseLock(`regen:${segmentId}`, lockToken);
  }
}
