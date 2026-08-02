import { db } from "../../db";
import { pronunciationDict } from "../../schema";
import { json } from "../response";
import { invalidateBookVoiceContextClusterwide } from "../../queue";
import { readJsonWithLimit, requireString, requireUuid, ValidationError } from "../../lib/validators";
import { AuthUser } from "../../auth";
import { ownedBook } from "../ownership";

const PRON_RE = /^\/api\/books\/([a-f0-9-]+)\/pronunciation$/i;
const MAX_TERM_LENGTH = 200;
const MAX_HINT_LENGTH = 200;

export async function registerPronunciationRoutes(req: Request, path: string, user: AuthUser): Promise<Response | null> {
  const match = path.match(PRON_RE);
  if (!match || req.method !== "POST") {
    return null;
  }

  const bookId = requireUuid(match[1], "bookId");
  if (!(await ownedBook(user.id, bookId))) return json({ error: "Book not found" }, 404);
  const body = (await readJsonWithLimit(req)) as Record<string, unknown>;
  const term = requireString(body, "term");
  const phoneticHint = requireString(body, "phoneticHint");

  if (term.length > MAX_TERM_LENGTH || phoneticHint.length > MAX_HINT_LENGTH) {
    throw new ValidationError(
      `term and phoneticHint must be ${MAX_TERM_LENGTH} characters or fewer`
    );
  }

  await db.insert(pronunciationDict).values({
    bookId,
    term,
    phoneticHint,
  }).onConflictDoUpdate({
    target: [pronunciationDict.bookId, pronunciationDict.term],
    set: { phoneticHint },
  });

  // The pipeline caches the pronunciation dict per book — drop it so the
  // next segment voiced picks up this term immediately.
  invalidateBookVoiceContextClusterwide(bookId);

  return json({ success: true });
}
