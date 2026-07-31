import { eq } from "drizzle-orm";
import { db } from "../db";
import { castMembers, pronunciationDict } from "../schema";
import { DEFAULT_NARRATOR_VOICE } from "./constants";

/**
 * Per-book voice context (narrator + pronunciation dictionary). These are
 * per-book invariants, but the pipeline previously re-fetched them from
 * Postgres for EVERY segment — two extra queries per segment voiced.
 * This cache keeps a short-TTL copy; write routes invalidate explicitly.
 */
export interface BookVoiceContext {
  narratorId: string | null;
  narratorVoice: string;
  narratorBaseStyle: string;
  pDict: Record<string, string>;
}

const TTL_MS = 5 * 60_000;
/** Soft cap so a long-lived process serving many books doesn't grow forever. */
const MAX_ENTRIES = 1000;

const cache = new Map<string, { ctx: BookVoiceContext; expiresAt: number }>();

/** Drop the cached context for a book (pronunciation edit, retry, delete…). */
export function invalidateBookVoiceContext(bookId: string): void {
  cache.delete(bookId);
}

function evictIfOversized(): void {
  if (cache.size <= MAX_ENTRIES) return;
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  // Still oversized (all fresh): drop oldest-inserted entries (Map order).
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/**
 * Returns the book's narrator + pronunciation dictionary, cached for TTL_MS.
 * Every book has exactly one cast row (the Narrator, inserted at ingestion);
 * the defensive fallbacks mirror the previous inline query behavior.
 */
export async function getBookVoiceContext(bookId: string): Promise<BookVoiceContext> {
  const hit = cache.get(bookId);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.ctx;
  }

  const [cast, pDictList] = await Promise.all([
    db.select().from(castMembers).where(eq(castMembers.bookId, bookId)),
    db.select().from(pronunciationDict).where(eq(pronunciationDict.bookId, bookId)),
  ]);

  const narrator = cast.find((c) => c.name.toLowerCase() === "narrator") ?? cast[0] ?? null;
  const ctx: BookVoiceContext = {
    narratorId: narrator?.id ?? null,
    narratorVoice: narrator?.ttsVoiceName ?? DEFAULT_NARRATOR_VOICE,
    narratorBaseStyle: narrator?.styleString ?? "warm neutral storyteller",
    pDict: Object.fromEntries(pDictList.map((p) => [p.term, p.phoneticHint])),
  };

  evictIfOversized();
  cache.set(bookId, { ctx, expiresAt: Date.now() + TTL_MS });
  return ctx;
}
