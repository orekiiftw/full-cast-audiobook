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
import { ensureLookahead } from "./lookahead";

/**
 * Atomically claim a segment for this worker.
 * Returns null if another worker already claimed it (or it was deleted).
 * The chapterId predicate ties the claim to the job's lineage: a corrupted
 * or injected job naming a different chapter can never flip the row.
 */
async function claimSegment(segmentId: string, chapterId: string) {
  const claimed = await db
    .update(segments)
    .set({ status: "processing" })
    .where(and(eq(segments.id, segmentId), eq(segments.chapterId, chapterId), eq(segments.status, "queued")))
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

    // Atomic claim — prevents double TTS if the same ID was enqueued twice.
    // The claim carries this job's lineage so a corrupted/injected Redis job
    // can never flip a row that belongs to a different book or chapter.
    const segmentData = await claimSegment(segmentId, chapterId);
    if (!segmentData) {
      return;
    }

    const chapterData = await db
      .select()
      .from(chapters)
      .where(eq(chapters.id, chapterId))
      .then((rows) => rows[0]);

    // Queue-integrity guard: a corrupted or manually-injected Redis job must
    // not process a segment under the wrong book/chapter context (the audio
    // key path embeds the job's bookId). Verify lineage before any paid work.
    if (!chapterData || chapterData.bookId !== bookId) {
      console.warn(`⚠️ Segment job ${segmentId}: job data does not match DB lineage (book ${bookId}/chapter ${chapterId}). Skipping.`);
      await db.update(segments).set({ status: "queued" }).where(eq(segments.id, segmentId));
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

    // Keep the just-in-time window full: each completion frees a slot, so top
    // up from this line forward. Without this the opening LOOKAHEAD_SEGMENTS
    // drain and the rest of the book stays "pending" forever until a listener
    // happens to poll — breaking progressive background generation.
    ensureLookahead(
      bookId,
      { chapterIndex, segmentIndex: segmentData.segmentIndex },
      { force: true }
    ).catch((err) =>
      console.warn(`⚠️ ensureLookahead after segment ${segmentId} failed:`, err)
    );
  } catch (error: unknown) {
    console.error(`❌ Failed to voice segment ${segmentId}:`, error);

    // A failure AFTER the row flipped to "voiced" is post-voiced bookkeeping
    // (counter bump, progress event, stitch enqueue). It must never requeue
    // the row for re-voicing (double TTS spend, counter double-bump on the
    // retry's flip) nor overwrite it to failed. Repair the chapter counters
    // from ground truth (idempotent) and enqueue the stitch if now terminal;
    // the BullMQ retry of this job then no-ops at the claim (row is voiced).
    const current = await db
      .select({ status: segments.status })
      .from(segments)
      .where(eq(segments.id, segmentId))
      .then((r) => r[0]);
    if (current?.status === "voiced") {
      try {
        const counters = await recomputeChapterCounters(chapterId);
        if (
          counters &&
          counters.totalCount > 0 &&
          counters.voicedCount + counters.failedCount >= counters.totalCount
        ) {
          await enqueueStitch({ bookId, chapterId, chapterIndex: job.data.chapterIndex });
        }
      } catch (repairErr) {
        console.error(`Post-voiced counter repair failed for chapter ${chapterId}:`, repairErr);
      }
      throw error;
    }

    const attempts = job.attemptsMade + 1;
    const permanentlyFailed = attempts >= PIPELINE.MAX_SEGMENT_ATTEMPTS;

    if (permanentlyFailed) {
      // Fail only this segment — keep the chapter playable for voiced lines.
      // Only bump failedCount when THIS execution flipped the row to failed
      // (guards a stalled-job race where two attempts both hit the terminal
      // path, and never overwrites an already-voiced row).
      const newlyFailed = await db
        .update(segments)
        .set({ attempts, status: "failed" })
        .where(and(eq(segments.id, segmentId), sql`${segments.status} != 'failed'`, sql`${segments.status} != 'voiced'`))
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
        // A permanent failure also frees a lookahead slot — promote the next
        // pending lines so one bad paragraph cannot stall the whole book.
        ensureLookahead(
          bookId,
          { chapterIndex: job.data.chapterIndex, segmentIndex: job.data.segmentIndex },
          { force: true }
        ).catch((err) =>
          console.warn(`⚠️ ensureLookahead after failed segment ${segmentId}:`, err)
        );
      }
    } else {
      // Non-terminal failures go back to "queued" so BullMQ's delayed retry can
      // re-claim them; the backoff itself lives in Redis (survives restarts),
      // replacing the old in-memory setTimeout re-queue. Never regress a row
      // another execution already voiced.
      await db
        .update(segments)
        .set({ attempts, status: "queued" })
        .where(and(eq(segments.id, segmentId), sql`${segments.status} != 'voiced'`));
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

/**
 * Idempotently recompute a chapter's terminal counters from ground truth.
 * The hot path uses atomic increments; this repairs drift after a post-voiced
 * bookkeeping failure (the increments are not retry-safe on their own).
 */
async function recomputeChapterCounters(chapterId: string) {
  await db.execute(sql`
    UPDATE chapters c
    SET total_count = s.total, voiced_count = s.voiced, failed_count = s.failed
    FROM (
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE status = 'voiced')::int AS voiced,
             COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
      FROM segments WHERE chapter_id = ${chapterId}
    ) s
    WHERE c.id = ${chapterId}
  `);
  return db
    .select({
      voicedCount: chapters.voicedCount,
      failedCount: chapters.failedCount,
      totalCount: chapters.totalCount,
    })
    .from(chapters)
    .where(eq(chapters.id, chapterId))
    .then((rows) => rows[0]);
}
