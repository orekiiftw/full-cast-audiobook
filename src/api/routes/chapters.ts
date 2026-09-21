import { asc, eq } from "drizzle-orm";
import { db } from "../../db";
import { segments } from "../../schema";
import { ensureChapterLookahead, prefetchNextChapter } from "../../orchestrator";
import { json } from "../response";
import { type RouteContext, type RouteTable } from "../route";
import { requireUuid } from "../../lib/validators";
import { ownedChapter } from "../ownership";

export const chapterRoutes: RouteTable = {
  "GET /api/chapters/:chapterId/segments": listChapterSegments,
  "GET /api/chapters/:chapterId/audio": redirectChapterAudio,
};

async function listChapterSegments({ user, params }: RouteContext): Promise<Response> {
  const chapterId = requireUuid(params.chapterId, "chapterId");
  const owned = await ownedChapter(user.id, chapterId);
  const chapter = owned?.chapter;
  if (!chapter) {
    return json({ error: "Chapter not found" }, 404);
  }

  const list = await listSegments(chapterId);

  prefetchNextChapter(chapter.bookId, chapter.chapterIndex).catch((err) =>
    console.error(`Lookahead prefetch failed for book ${chapter.bookId} ch ${chapter.chapterIndex}:`, err),
  );

  ensureChapterLookahead(chapter.bookId, chapter.chapterIndex).catch((err) =>
    console.error(`Lookahead ensure failed for book ${chapter.bookId} ch ${chapter.chapterIndex}:`, err),
  );

  return json({
    chapter,
    segments: list.map((segment) => toSegmentSummary(segment, chapterId)),
  });
}

async function redirectChapterAudio({ user, params }: RouteContext): Promise<Response> {
  const chapterId = requireUuid(params.chapterId, "chapterId");
  const owned = await ownedChapter(user.id, chapterId);
  const chapter = owned?.chapter;
  if (!chapter) {
    return json({ error: "Chapter not found" }, 404);
  }

  if (chapter.status !== "ready" || !chapter.audioR2Key) {
    return json({ error: "Chapter audio is not stitched or ready yet" }, 400);
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: `/api/audio?key=${encodeURIComponent(chapter.audioR2Key)}&v=${chapter.durationMs ?? 0}`,
    },
  });
}

function listSegments(chapterId: string) {
  return db
    .select({
      id: segments.id,
      segmentIndex: segments.segmentIndex,
      rawText: segments.rawText,
      status: segments.status,
      audioR2Key: segments.audioR2Key,
      durationMs: segments.durationMs,
    })
    .from(segments)
    .where(eq(segments.chapterId, chapterId))
    .orderBy(asc(segments.segmentIndex));
}

function toSegmentSummary(segment: Awaited<ReturnType<typeof listSegments>>[number], chapterId: string) {
  return {
    id: segment.id,
    chapterId,
    segmentIndex: segment.segmentIndex,
    rawText: segment.rawText,
    status: segment.status,
    audioUrl: segment.audioR2Key ? `/api/audio?key=${encodeURIComponent(segment.audioR2Key)}&v=${segment.durationMs ?? 0}` : null,
    durationMs: segment.durationMs,
  };
}
