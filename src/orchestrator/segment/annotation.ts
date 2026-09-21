import { and, desc, eq, isNotNull, lt } from "drizzle-orm";
import { db } from "../../db";
import { segments } from "../../schema";
import { annotateSegment, createNeutralBeat, extractBeats, type BeatAnnotation } from "../../narration/annotation";
import { firstRow } from "../../lib/query";

type SegmentRow = typeof segments.$inferSelect;

export async function loadSegmentBeats(chapterId: string, segmentRow: SegmentRow, narratorId: string | null): Promise<BeatAnnotation[]> {
  const previousTexts = await findPreviousSegmentTexts(chapterId, segmentRow.segmentIndex);
  const runningSummary = await findRunningSummary(chapterId, segmentRow.segmentIndex);
  return annotateOrReuseSegment(segmentRow, previousTexts, runningSummary, narratorId);
}

async function findPreviousSegmentTexts(chapterId: string, segmentIndex: number): Promise<string[]> {
  const previousSegments = await db
    .select({ rawText: segments.rawText })
    .from(segments)
    .where(and(eq(segments.chapterId, chapterId), lt(segments.segmentIndex, segmentIndex)))
    .orderBy(desc(segments.segmentIndex))
    .limit(2);
  return previousSegments.map((segment) => segment.rawText).reverse();
}

async function findRunningSummary(chapterId: string, segmentIndex: number): Promise<string> {
  const previousSummary = await firstRow(
    db
      .select({ sceneSummary: segments.sceneSummary })
      .from(segments)
      .where(and(eq(segments.chapterId, chapterId), lt(segments.segmentIndex, segmentIndex), isNotNull(segments.sceneSummary)))
      .orderBy(desc(segments.segmentIndex))
      .limit(1),
  );
  return previousSummary?.sceneSummary || "A scene in the book.";
}

async function annotateOrReuseSegment(
  segmentRow: SegmentRow,
  previousTexts: string[],
  runningSummary: string,
  narratorId: string | null,
): Promise<BeatAnnotation[]> {
  const existingBeats = extractBeats(segmentRow.annotatedJson);
  if (existingBeats.length > 0) {
    await db.update(segments).set({ status: "annotated" }).where(eq(segments.id, segmentRow.id));
    return existingBeats;
  }

  let beats: BeatAnnotation[] = [];
  let sceneSummary = segmentRow.sceneSummary || runningSummary;

  try {
    const annotation = await annotateSegment(segmentRow.rawText, previousTexts, runningSummary);
    beats = annotation.beats;
    sceneSummary = annotation.scene_summary || runningSummary;
  } catch (err) {
    console.warn(`⚠️ Annotation failed for segment ${segmentRow.id}; falling back to a single neutral beat.`, err);
  }

  if (beats.length === 0) {
    beats = [createNeutralBeat(segmentRow.rawText)];
  }

  await db
    .update(segments)
    .set({
      annotatedJson: { scene_summary: sceneSummary, beats },
      sceneSummary,
      speakerCastId: narratorId,
      status: "annotated",
    })
    .where(eq(segments.id, segmentRow.id));

  return beats;
}
