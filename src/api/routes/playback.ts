import { db } from "../../db";
import { playbackState } from "../../schema";
import { ensureChapterLookahead, ensureLookahead } from "../../orchestrator";
import { json } from "../response";
import { type RouteContext, type RouteTable } from "../route";
import { ValidationError, requireNumber, requireUuid } from "../../lib/validators";
import { readJsonWithLimit } from "../body";
import { ownedBook, ownedChapter } from "../ownership";

const MAX_POSITION_MS = 7 * 24 * 60 * 60 * 1000;

export const playbackRoutes: RouteTable = {
  "PUT /api/playback": syncPlayback,
};

interface PlaybackPayload {
  bookId: string;
  chapterId: string;
  positionMs: number;
  segmentIndex?: number;
}

async function syncPlayback({ req, user }: RouteContext): Promise<Response> {
  const payload = await readPlaybackPayload(req);

  const [book, chapter] = await Promise.all([ownedBook(user.id, payload.bookId), ownedChapter(user.id, payload.chapterId)]);
  if (!book || !chapter || chapter.chapter.bookId !== payload.bookId) {
    return json({ error: "Book or chapter not found" }, 404);
  }

  await storePlaybackPosition(payload);

  const chapterIndex = chapter.chapter.chapterIndex;
  ensureChapterLookahead(payload.bookId, chapterIndex).catch((err) =>
    console.error(`Lookahead ensure failed for book ${payload.bookId} ch ${chapterIndex}:`, err),
  );

  if (payload.segmentIndex !== undefined) {
    ensureLookahead(payload.bookId, { chapterIndex, segmentIndex: payload.segmentIndex }).catch((err) =>
      console.error(`Lookahead re-center failed for book ${payload.bookId} ch ${chapterIndex} seg ${payload.segmentIndex}:`, err),
    );
  }

  return json({ success: true });
}

async function readPlaybackPayload(req: Request): Promise<PlaybackPayload> {
  const body = (await readJsonWithLimit(req)) as Record<string, unknown>;
  const bookId = requireUuid(body.bookId, "bookId");
  const chapterId = requireUuid(body.chapterId, "chapterId");
  const positionMs = requireNumber(body, "positionMs");
  const segmentIndex = body.segmentIndex === undefined ? undefined : requireNumber(body, "segmentIndex");

  if (!Number.isFinite(positionMs) || positionMs < 0 || positionMs > MAX_POSITION_MS) {
    throw new ValidationError(`Field positionMs must be between 0 and ${MAX_POSITION_MS}`);
  }
  if (segmentIndex !== undefined && (!Number.isInteger(segmentIndex) || segmentIndex < 1)) {
    throw new ValidationError("Field segmentIndex must be a positive integer");
  }

  return { bookId, chapterId, positionMs, segmentIndex };
}

async function storePlaybackPosition({ bookId, chapterId, positionMs }: PlaybackPayload): Promise<void> {
  const rounded = Math.round(positionMs);

  await db
    .insert(playbackState)
    .values({
      bookId,
      chapterId,
      positionMs: rounded,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [playbackState.bookId, playbackState.chapterId],
      set: {
        positionMs: rounded,
        updatedAt: new Date(),
      },
    });
}
