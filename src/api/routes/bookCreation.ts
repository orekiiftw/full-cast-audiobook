import { submitBook } from "../../books";
import { json } from "../response";
import type { RouteContext } from "../route";
import { searchRateLimited } from "./bookSearch";
import { readBookSubmission } from "./bookSubmission";

export async function createBook({ req, user }: RouteContext): Promise<Response> {
  const submission = await readBookSubmission(req);

  if (submission.requestedProviderBook && searchRateLimited(user.id)) {
    return json({ error: "Too many book lookups. Try again later." }, 429);
  }
  const result = await submitBook(user.id, submission);
  if (!result.ok) {
    return json({ error: result.error, book: result.book }, 400);
  }
  return json(result.book);
}
