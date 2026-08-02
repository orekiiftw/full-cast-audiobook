import { asc, eq } from "drizzle-orm";
import { db } from "../../db";
import { segments } from "../../schema";
import { ensureChapterLookahead, prefetchNextChapter } from "../../orchestrator";
import { json } from "../response";
import { requireUuid } from "../../lib/validators";
import { AuthUser } from "../../auth";
import { ownedChapter } from "../ownership";

const SEGMENTS_RE = /^\/api\/chapters\/([a-f0-9-]+)\/segments$/i;
const AUDIO_RE = /^\/api\/chapters\/([a-f0-9-]+)\/audio$/i;

export async function registerChapterRoutes(req: Request, path: string, user: AuthUser): Promise<Response | null> {
  // ----------------------------------------------------
  // GET /api/chapters/:id/segments
  // ----------------------------------------------------
  const segmentsMatch = path.match(SEGMENTS_RE);
  if (segmentsMatch && req.method === "GET") {
    const chapterId = requireUuid(segmentsMatch[1], "chapterId");
    const owned = await ownedChapter(user.id, chapterId);
    const chapter = owned?.chapter;
    if (!chapter) {
      return json({ error: "Chapter not found" }, 404);
    }

    const list = await db
      .select()
      .from(segments)
      .where(eq(segments.chapterId, chapterId))
      .orderBy(asc(segments.segmentIndex));

    // Prefetch next chapter in the background (don't block the response)
    prefetchNextChapter(chapter.bookId, chapter.chapterIndex).catch(console.error);

    // Transcribe this chapter fully + the next chapter so the buffering
    // player's lines voice without interruption and the next chapter is
    // ready when the listener reaches it. Idempotent — repeated polls no-op.
    ensureChapterLookahead(chapter.bookId, chapter.chapterIndex).catch(console.error);

    return json({
      chapter,
      segments: list.map((s) => ({
        id: s.id,
        chapterId,
        segmentIndex: s.segmentIndex,
        rawText: s.rawText,
        status: s.status,
        // v=duration busts CDN/browser cache when a line is regenerated in place
        audioUrl: s.audioR2Key
          ? `/api/audio?key=${encodeURIComponent(s.audioR2Key)}&v=${s.durationMs ?? 0}`
          : null,
        durationMs: s.durationMs,
      })),
    });
  }

  // ----------------------------------------------------
  // GET /api/chapters/:id/audio -> 302 to stitched chapter file
  // ----------------------------------------------------
  const audioMatch = path.match(AUDIO_RE);
  if (audioMatch && req.method === "GET") {
    const chapterId = requireUuid(audioMatch[1], "chapterId");
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
        // v=duration busts the year-long immutable audio cache when a segment
        // regeneration re-stitches the chapter in place (same R2 key), exactly
        // like the per-segment audioUrl versioning above.
        Location: `/api/audio?key=${encodeURIComponent(chapter.audioR2Key)}&v=${chapter.durationMs ?? 0}`,
      },
    });
  }

  return null;
}
