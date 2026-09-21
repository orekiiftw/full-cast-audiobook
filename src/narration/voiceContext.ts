import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { castMembers, chapters, pronunciationDict, segments } from "../schema";
import { firstRow } from "../lib/query";
import { DEFAULT_NARRATOR_VOICE } from "../lib/constants";
import { detectIndicLanguage } from "../lib/language";

export interface BookVoiceContext {
  narratorId: string | null;
  narratorVoice: string;
  narratorBaseStyle: string;
  pDict: Record<string, string>;
  language: string | null;
}

interface CachedContext {
  context: BookVoiceContext;
  expiresAt: number;
}

const VOICE_CONTEXT_TTL_MS = 5 * 60_000;
const MAX_CACHED_VOICE_CONTEXTS = 1000;
const LANGUAGE_SAMPLE_SEGMENTS = 30;
const LANGUAGE_SAMPLE_OFFSET_RATIO = 0.25;

const contextCache = new Map<string, CachedContext>();

export function invalidateBookVoiceContext(bookId: string): void {
  contextCache.delete(bookId);
}

export async function getBookVoiceContext(bookId: string): Promise<BookVoiceContext> {
  const cached = readCachedContext(bookId);
  if (cached) return cached;

  const [cast, pronunciationRows] = await Promise.all([
    db.select().from(castMembers).where(eq(castMembers.bookId, bookId)),
    db.select().from(pronunciationDict).where(eq(pronunciationDict.bookId, bookId)),
  ]);

  const narrator = cast.find((member) => member.name.toLowerCase() === "narrator") ?? cast[0] ?? null;
  const context: BookVoiceContext = {
    narratorId: narrator?.id ?? null,
    narratorVoice: narrator?.ttsVoiceName ?? DEFAULT_NARRATOR_VOICE,
    narratorBaseStyle: narrator?.styleString ?? "warm neutral storyteller",
    pDict: Object.fromEntries(pronunciationRows.map((row) => [row.term, row.phoneticHint])),
    language: await resolveBookLanguage(bookId),
  };

  writeCachedContext(bookId, context);
  return context;
}

function readCachedContext(bookId: string): BookVoiceContext | null {
  const entry = contextCache.get(bookId);
  return entry && entry.expiresAt > Date.now() ? entry.context : null;
}

function writeCachedContext(bookId: string, context: BookVoiceContext): void {
  evictIfOversized();
  contextCache.set(bookId, { context, expiresAt: Date.now() + VOICE_CONTEXT_TTL_MS });
}

function evictIfOversized(): void {
  if (contextCache.size <= MAX_CACHED_VOICE_CONTEXTS) return;

  const now = Date.now();
  for (const [bookId, entry] of contextCache) {
    if (entry.expiresAt <= now) contextCache.delete(bookId);
  }

  while (contextCache.size > MAX_CACHED_VOICE_CONTEXTS) {
    const oldest = contextCache.keys().next();
    if (oldest.done) break;
    contextCache.delete(oldest.value);
  }
}

async function resolveBookLanguage(bookId: string): Promise<string | null> {
  const total = await firstRow(
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(segments)
      .innerJoin(chapters, eq(segments.chapterId, chapters.id))
      .where(eq(chapters.bookId, bookId)),
  );

  const offset = Math.floor((total?.count ?? 0) * LANGUAGE_SAMPLE_OFFSET_RATIO);

  const sample = await db
    .select({ rawText: segments.rawText })
    .from(segments)
    .innerJoin(chapters, eq(segments.chapterId, chapters.id))
    .where(eq(chapters.bookId, bookId))
    .orderBy(chapters.chapterIndex, segments.segmentIndex)
    .limit(LANGUAGE_SAMPLE_SEGMENTS)
    .offset(offset);

  return detectIndicLanguage(sample.map((row) => row.rawText).join("\n"));
}
