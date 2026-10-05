import { db } from "../db";
import { playbackState } from "../schema";
import { ensureChapterLookahead, ensureLookahead } from "../orchestrator";

export interface PlaybackPosition {
  bookId: string;
  chapterId: string;
  positionMs: number;
  segmentIndex?: number;
}

export async function syncPlaybackPosition(position: PlaybackPosition, chapterIndex: number): Promise<void> {
  await storePlaybackPosition(position);

  ensureChapterLookahead(position.bookId, chapterIndex).catch((err) =>
    console.error(`Lookahead ensure failed for book ${position.bookId} ch ${chapterIndex}:`, err),
  );

  if (position.segmentIndex !== undefined) {
    ensureLookahead(position.bookId, { chapterIndex, segmentIndex: position.segmentIndex }).catch((err) =>
      console.error(`Lookahead re-center failed for book ${position.bookId} ch ${chapterIndex} seg ${position.segmentIndex}:`, err),
    );
  }
}

async function storePlaybackPosition({ bookId, chapterId, positionMs }: PlaybackPosition): Promise<void> {
  const rounded = Math.round(positionMs);

  await db
    .insert(playbackState)
    .values({ bookId, chapterId, positionMs: rounded, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [playbackState.bookId, playbackState.chapterId],
      set: { positionMs: rounded, updatedAt: new Date() },
    });
}
