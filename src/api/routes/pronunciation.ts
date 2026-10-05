import { upsertPronunciationTerm } from "../../narration/pronunciation";
import { json } from "../response";
import { type RouteContext, type RouteTable } from "../route";
import { ValidationError, requireString, requireUuid } from "../../lib/validators";
import { readJsonWithLimit } from "../body";
import { ownedBook } from "../../books/ownership";

const MAX_TERM_LENGTH = 200;

const MAX_HINT_LENGTH = 200;

export const pronunciationRoutes: RouteTable = {
  "POST /api/books/:bookId/pronunciation": savePronunciationTerm,
};

async function savePronunciationTerm({ req, user, params }: RouteContext): Promise<Response> {
  const bookId = requireUuid(params.bookId, "bookId");
  if (!(await ownedBook(user.id, bookId))) return json({ error: "Book not found" }, 404);

  const { term, phoneticHint } = await readPronunciationTerm(req);
  await upsertPronunciationTerm(bookId, term, phoneticHint);

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
