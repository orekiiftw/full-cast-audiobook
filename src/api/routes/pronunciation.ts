import { and, count, eq, ne } from "drizzle-orm";
import { db } from "../../db";
import { pronunciationDict } from "../../schema";
import { json } from "../response";
import { type RouteContext, type RouteTable } from "../route";
import { invalidateBookVoiceContextClusterwide } from "../../queue";
import { firstRow } from "../../lib/query";
import { ValidationError, requireString, requireUuid } from "../../lib/validators";
import { readJsonWithLimit } from "../body";
import { ownedBook } from "../ownership";

const MAX_TERM_LENGTH = 200;
const MAX_HINT_LENGTH = 200;
const MAX_TERMS_PER_BOOK = 500;

export const pronunciationRoutes: RouteTable = {
  "POST /api/books/:bookId/pronunciation": upsertPronunciationTerm,
};

async function upsertPronunciationTerm({ req, user, params }: RouteContext): Promise<Response> {
  const bookId = requireUuid(params.bookId, "bookId");
  if (!(await ownedBook(user.id, bookId))) return json({ error: "Book not found" }, 404);

  const { term, phoneticHint } = await readPronunciationTerm(req);
  await assertTermCapacity(bookId, term);
  await saveTerm(bookId, term, phoneticHint);

  invalidateBookVoiceContextClusterwide(bookId);

  return json({ success: true });
}

async function readPronunciationTerm(req: Request): Promise<{ term: string; phoneticHint: string }> {
  const body = (await readJsonWithLimit(req)) as Record<string, unknown>;
  const term = requireString(body, "term");
  const phoneticHint = requireString(body, "phoneticHint");

  if (term.length > MAX_TERM_LENGTH || phoneticHint.length > MAX_HINT_LENGTH) {
    throw new ValidationError(`term and phoneticHint must be ${MAX_TERM_LENGTH} characters or fewer`);
  }

  return { term, phoneticHint };
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
