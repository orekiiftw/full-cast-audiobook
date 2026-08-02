import { db } from "../../db";
import { playbackState } from "../../schema";
import { ensureChapterLookahead } from "../../orchestrator";
import { json } from "../response";
import { readJsonWithLimit, requireNumber, requireUuid, ValidationError } from "../../lib/validators";
import { AuthUser } from "../../auth";
import { ownedBook, ownedChapter } from "../ownership";

// Sanity cap: seek positions beyond a week are clearly corrupt
const MAX_POSITION_MS = 7 * 24 * 60 * 60 * 1000;

export async function registerPlaybackRoutes(req: Request, path: string, user: AuthUser): Promise<Response | null> {
  if (path !== "/api/playback" || req.method !== "PUT") {
    return null;
  }

  const body = (await readJsonWithLimit(req)) as Record<string, unknown>;
  const bookId = requireUuid(body.bookId, "bookId");
  const chapterId = requireUuid(body.chapterId, "chapterId");
  const positionMs = requireNumber(body, "positionMs");
  // Optional 1-based index of the line currently playing — the lookahead
  // window re-centers on it so voicing stays just ahead of the listener.
  const segmentIndex = body.segmentIndex === undefined ? undefined : requireNumber(body, "segmentIndex");

  if (!Number.isFinite(positionMs) || positionMs < 0 || positionMs > MAX_POSITION_MS) {
    throw new ValidationError(`Field positionMs must be between 0 and ${MAX_POSITION_MS}`);
  }
  if (segmentIndex !== undefined && (!Number.isInteger(segmentIndex) || segmentIndex < 1)) {
    throw new ValidationError("Field segmentIndex must be a positive integer");
  }

  const [book, chapter] = await Promise.all([ownedBook(user.id, bookId), ownedChapter(user.id, chapterId)]);
  if (!book || !chapter || chapter.chapter.bookId !== bookId) {
    return json({ error: "Book or chapter not found" }, 404);
  }

  // Atomic upsert — the previous select-then-insert raced concurrent syncs
  // and died on the (book_id, chapter_id) unique constraint.
  await db
    .insert(playbackState)
    .values({
      bookId,
      chapterId,
      positionMs: Math.round(positionMs),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [playbackState.bookId, playbackState.chapterId],
      set: {
        positionMs: Math.round(positionMs),
        updatedAt: new Date(),
      },
    });

  // Transcribe the current chapter fully + the next chapter so playback is
  // uninterrupted and the next chapter is ready when the listener reaches it.
  // Nothing beyond N+1 is scheduled until the listener advances, capping TTS
  // spend at two chapters ahead. (fire-and-forget — sync must not wait on it.)
  ensureChapterLookahead(bookId, chapter.chapter.chapterIndex).catch(console.error);

  return json({ success: true });
}
