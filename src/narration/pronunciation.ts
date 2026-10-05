import { and, count, eq, ne } from "drizzle-orm";
import { db } from "../db";
import { pronunciationDict } from "../schema";
import { invalidateBookVoiceContextClusterwide } from "../queue";
import { firstRow } from "../lib/query";
import { ValidationError } from "../lib/validators";

const MAX_TERMS_PER_BOOK = 500;

export async function upsertPronunciationTerm(bookId: string, term: string, phoneticHint: string): Promise<void> {
  await assertTermCapacity(bookId, term);
  await saveTerm(bookId, term, phoneticHint);
  invalidateBookVoiceContextClusterwide(bookId);
}

async function assertTermCapacity(bookId: string, term: string): Promise<void> {
  const otherTerms = await firstRow(
    db
      .select({ value: count() })
      .from(pronunciationDict)
      .where(and(eq(pronunciationDict.bookId, bookId), ne(pronunciationDict.term, term))),
  );
  if ((otherTerms?.value ?? 0) >= MAX_TERMS_PER_BOOK) {
    throw new ValidationError(`A book cannot have more than ${MAX_TERMS_PER_BOOK} pronunciation terms`);
  }
}

async function saveTerm(bookId: string, term: string, phoneticHint: string): Promise<void> {
  await db
    .insert(pronunciationDict)
    .values({ bookId, term, phoneticHint })
    .onConflictDoUpdate({
      target: [pronunciationDict.bookId, pronunciationDict.term],
      set: { phoneticHint },
    });
}
