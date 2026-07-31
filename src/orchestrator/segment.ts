/**
 * Segment voicing: the BullMQ "segments" processor — annotation → TTS beat
 * synthesis → merge → upload, with the atomic DB claim as the final guard
 * against duplicate execution.
 */
import type { Job } from "bullmq";
import { and, desc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { chapters, segments } from "../schema";
import { annotateSegment, createNeutralBeat, extractBeats } from "../annotationService";
import { uploadFile } from "../r2";
import { PIPELINE } from "../lib/constants";
import { synthesizeSegmentAudio } from "../lib/voiceSegment";
import { getBookVoiceContext } from "../lib/bookCache";
import { emitProgressEvent, enqueueStitch, type SegmentJobData } from "../queue";

/**
 * Atomically claim a segment for this worker.
 * Returns null if another worker already claimed it (or it was deleted).
 */
async function claimSegment(segmentId: string) {
  const claimed = await db
    .update(segments)
    .set({ status: "processing" })
    .where(and(eq(segments.id, segmentId), eq(segments.status, "queued")))
    .returning();
  return claimed[0] ?? null;
}

/**
 * Segment processor: Annotation -> TTS beat generations -> merge -> upload.
 * BullMQ owns retries with durable exponential backoff (previously in-memory
 * setTimeout, lost on crash); the DB attempts column is kept in sync for
 * observability and the sweeper's exhaustion check.
 */
export async function runSegmentJob(job: Job<SegmentJobData>): Promise<void> {
  const { bookId, chapterId, segmentId } = job.data;

  try {
    // Crash-window recovery: a retry (attemptsMade > 0) can follow a crash
    // that left the row claimed mid-flight (between the atomic claim and the
    // failure handler). Reset it so the claim below can succeed. A live
    // worker holding this exact job is impossible — BullMQ runs one job
    // record on one worker at a time.
    if (job.attemptsMade > 0) {
      await db
        .update(segments)
        .set({ status: "queued" })
        .where(and(eq(segments.id, segmentId), inArray(segments.status, ["processing", "annotated"])));
    }

    // Atomic claim — prevents double TTS if the same ID was enqueued twice
    const segmentData = await claimSegment(segmentId);
    if (!segmentData) {
      return;
    }

    const chapterData = await db
      .select()
      .from(chapters)
      .where(eq(chapters.id, chapterId))
      .then((rows) => rows[0]);

    if (!chapterData) {
      // Book/chapter was deleted while the job was in flight. Not an error —
      // do not burn retry attempts on it.
      console.warn(`⚠️ Segment job ${segmentId}: chapter ${chapterId} gone (book deleted?). Skipping.`);
      return;
    }

    const chapterIndex = chapterData.chapterIndex;

    // Narrator + pronunciation dict are per-book invariants — served from the
    // short-TTL cache instead of two Postgres queries per segment.
    const { narratorId, narratorVoice, narratorBaseStyle, pDict } =
      await getBookVoiceContext(bookId);

    // Mark chapter processing
    if (chapterData.status === "queued") {
      await db.update(chapters).set({ status: "processing" }).where(eq(chapters.id, chapterId));
      emitProgressEvent(bookId, "chapter_status", {
        chapterId,
        status: "processing",
        chapterIndex,
      });
    }

    // Previous 2 segments by index (true narrative context, not "any voiced").
    // Bounded queries via the (chapterId, segmentIndex) index — the old
    // "fetch every prior segment's full text, keep the last two" scan made
    // annotation context O(segments²) row reads per chapter.
    const prevSegs = await db
      .select({ rawText: segments.rawText })
      .from(segments)
      .where(
        and(eq(segments.chapterId, chapterId), lt(segments.segmentIndex, segmentData.segmentIndex))
      )
      .orderBy(desc(segments.segmentIndex))
      .limit(2);
    const prevTexts = prevSegs.map((s) => s.rawText).reverse();

    // Running summary from the nearest prior segment that has one
    const summaryRow = await db
      .select({ sceneSummary: segments.sceneSummary })
      .from(segments)
      .where(
        and(
          eq(segments.chapterId, chapterId),
          lt(segments.segmentIndex, segmentData.segmentIndex),
          isNotNull(segments.sceneSummary)
        )
      )
      .orderBy(desc(segments.segmentIndex))
      .limit(1)
      .then((rows) => rows[0]);
    const runningSummary = summaryRow?.sceneSummary || "A scene in the book.";

    // Annotate if needed (reuse prior annotation when present)
    let beats = extractBeats(segmentData.annotatedJson);
    let sceneSummary = segmentData.sceneSummary || runningSummary;

    if (beats.length === 0) {
      try {
        const annotationRes = await annotateSegment(
          segmentData.rawText,
          prevTexts,
          runningSummary
        );

        beats = annotationRes.beats;
        sceneSummary = annotationRes.scene_summary || runningSummary;
      } catch (err) {
        // Annotation failure must not burn a segment attempt — voice it plainly
        console.warn(
          `⚠️ Annotation failed for segment ${segmentId}; falling back to a single neutral beat.`,
          err
        );
      }

      if (beats.length === 0) {
        beats = [createNeutralBeat(segmentData.rawText)];
      }

      await db
        .update(segments)
        .set({
          annotatedJson: { scene_summary: sceneSummary, beats },
          sceneSummary,
          speakerCastId: narratorId,
          status: "annotated",
        })
        .where(eq(segments.id, segmentId));
    } else {
      await db
        .update(segments)
        .set({ status: "annotated" })
        .where(eq(segments.id, segmentId));
    }

    if (!beats || beats.length === 0) {
      throw new Error("No beats available for TTS after annotation");
    }

    console.log(`🎙️ Voicing segment ${segmentData.segmentIndex} (contains ${beats.length} beats)`);

    // Beats synthesize CONCURRENTLY (the TTS provider's global slot limiter
    // still bounds total in-flight requests account-wide) and merge in
    // memory — no per-segment ffmpeg spawn unless a WAV can't be spliced.
    const { wav: finalBytes, durationMs } = await synthesizeSegmentAudio(beats, {
      narratorVoice,
      narratorBaseStyle,
      pDict,
      tempDirPrefix: "seg_tts_",
      onBeatStart: (i, total) => {
        emitProgressEvent(bookId, "progress_log", {
          message: `Synthesizing segment ${segmentData.segmentIndex}, part ${i + 1} of ${total}...`,
        });
      },
    });

    const segmentR2Key = `books/${bookId}/chapters/ch_${chapterIndex}/segment_${segmentData.segmentIndex}.wav`;
    await uploadFile(segmentR2Key, finalBytes, "audio/wav");

    // Duplicate-execution guard: a stalled-job race (worker frozen past its
    // lock, job recovered elsewhere) could run TTS twice for one segment.
    // Only the execution that flips the row to "voiced" may bump counters —
    // the other stops here. (Cost of the race: one duplicate synthesis.)
    const voicedRows = await db
      .update(segments)
      .set({
        audioR2Key: segmentR2Key,
        durationMs,
        status: "voiced",
      })
      .where(and(eq(segments.id, segmentId), sql`${segments.status} != 'voiced'`))
      .returning({ id: segments.id });
    if (voicedRows.length === 0) {
      console.warn(`⚠️ Segment ${segmentId} was already voiced by a duplicate execution — skipping counter update.`);
      return;
    }

    // Atomically bump the chapter's terminal counter; the fresh counters drive
    // progress events and the stitch/partial-ready decisions — replacing the
    // old "re-select every segment of the chapter" per completion (O(n) → O(1)).
    const counters = await db
      .update(chapters)
      .set({ voicedCount: sql`${chapters.voicedCount} + 1` })
      .where(eq(chapters.id, chapterId))
      .returning({
        voicedCount: chapters.voicedCount,
        failedCount: chapters.failedCount,
        totalCount: chapters.totalCount,
      })
      .then((rows) => rows[0]);
    const progress = counters ?? { voicedCount: 0, failedCount: 0, totalCount: 0 };

    // Absolute chapter progress so the UI never drifts on reconnect/duplicate events
    emitProgressEvent(bookId, "segment_ready", {
      chapterId,
      chapterIndex,
      segmentId,
      segmentIndex: segmentData.segmentIndex,
      audioR2Key: segmentR2Key,
      done: progress.voicedCount,
      total: progress.totalCount,
      voicedCount: progress.voicedCount,
    });

    // Partial ready only when the leading consecutive segments are voiced
    await maybeMarkPartialReady(bookId, chapterId, chapterIndex, chapterData.status, progress);

    // Stitch once every segment is terminal (voiced or permanently failed)
    if (
      progress.totalCount > 0 &&
      progress.voicedCount + progress.failedCount >= progress.totalCount
    ) {
      await enqueueStitch({ bookId, chapterId, chapterIndex });
    }
  } catch (error: unknown) {
    console.error(`❌ Failed to voice segment ${segmentId}:`, error);

    const attempts = job.attemptsMade + 1;
    const permanentlyFailed = attempts >= PIPELINE.MAX_SEGMENT_ATTEMPTS;

    if (permanentlyFailed) {
      // Fail only this segment — keep the chapter playable for voiced lines.
      // Only bump failedCount when THIS execution flipped the row to failed
      // (guards a stalled-job race where two attempts both hit the terminal path).
      const newlyFailed = await db
        .update(segments)
        .set({ attempts, status: "failed" })
        .where(and(eq(segments.id, segmentId), sql`${segments.status} != 'failed'`))
        .returning({ id: segments.id });

      if (newlyFailed.length > 0) {
        emitProgressEvent(bookId, "segment_failed", {
          segmentId,
          chapterId,
          error: "Narration failed for this paragraph. You can retry it from the reading view.",
        });
        const counters = await db
          .update(chapters)
          .set({ failedCount: sql`${chapters.failedCount} + 1` })
          .where(eq(chapters.id, chapterId))
          .returning({
            voicedCount: chapters.voicedCount,
            failedCount: chapters.failedCount,
            totalCount: chapters.totalCount,
          })
          .then((rows) => rows[0]);
        if (
          counters &&
          counters.totalCount > 0 &&
          counters.voicedCount + counters.failedCount >= counters.totalCount
        ) {
          await enqueueStitch({ bookId, chapterId, chapterIndex: job.data.chapterIndex });
        }
      }
    } else {
      // Non-terminal failures go back to "queued" so BullMQ's delayed retry can
      // re-claim them; the backoff itself lives in Redis (survives restarts),
      // replacing the old in-memory setTimeout re-queue.
      await db
        .update(segments)
        .set({ attempts, status: "queued" })
        .where(eq(segments.id, segmentId));
      console.log(
        `⏳ Segment ${segmentId} requeued by BullMQ backoff (attempt ${attempts}/${PIPELINE.MAX_SEGMENT_ATTEMPTS})`
      );
    }

    // Let BullMQ record the failure and schedule the next delayed attempt.
    throw error;
  }
}

/**
 * Unlock progressive "Listen Live" playback once the leading segment window is ready.
 * Default window is 1 segment so listeners can start as soon as the first line is voiced.
 */
async function maybeMarkPartialReady(
  bookId: string,
  chapterId: string,
  chapterIndex: number,
  currentStatus: string,
  counters: { voicedCount: number; failedCount: number; totalCount: number }
) {
  if (currentStatus !== "processing" && currentStatus !== "queued") return;

  const threshold = PIPELINE.PARTIAL_READY_THRESHOLD;

  if (counters.totalCount <= threshold) {
    // Chapter has fewer segments than the unlock window: require the whole
    // chapter terminal with at least one playable line (a single permanent
    // failure must not block progressive playback forever).
    if (counters.totalCount === 0) return;
    if (counters.voicedCount + counters.failedCount < counters.totalCount) return;
    if (counters.voicedCount === 0) return;
  } else {
    const leadingIndexes = Array.from({ length: threshold }, (_, i) => i + 1);
    const leading = await db
      .select({ status: segments.status, segmentIndex: segments.segmentIndex })
      .from(segments)
      .where(and(eq(segments.chapterId, chapterId), inArray(segments.segmentIndex, leadingIndexes)));

    // Unlock once the leading window is terminal and at least one line is playable
    const windowDone =
      leading.length > 0 && leading.every((s) => s.status === "voiced" || s.status === "failed");
    const anyPlayable = leading.some((s) => s.status === "voiced");
    if (!windowDone || !anyPlayable) return;
  }

  // Re-read chapter to avoid overwriting ready/failed
  const ch = await db
    .select({ status: chapters.status })
    .from(chapters)
    .where(eq(chapters.id, chapterId))
    .then((r) => r[0]);
  if (!ch || ch.status === "ready" || ch.status === "partial_ready" || ch.status === "failed") {
    return;
  }

  await db.update(chapters).set({ status: "partial_ready" }).where(eq(chapters.id, chapterId));
  emitProgressEvent(bookId, "chapter_status", {
    chapterId,
    status: "partial_ready",
    chapterIndex,
  });
}
