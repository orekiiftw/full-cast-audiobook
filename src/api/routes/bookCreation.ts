import { submitBook } from "../../books";
import { json } from "../response";
import type { RouteContext } from "../route";
import { searchRateLimited } from "./bookSearch";
import { isMultipartRequest, readBookSubmission } from "./bookSubmission";

const MAX_UPLOADS_PER_USER = 2;

const activeUploadsByUser = new Map<string, number>();

export async function createBook({ req, user }: RouteContext): Promise<Response> {
  if (!isMultipartRequest(req)) return submitBookRequest(req, user.id);

  if (!openUploadSlot(user.id)) {
    return json({ error: "Too many uploads in progress. Wait for one to finish and try again." }, 429);
  }
  try {
    return await submitBookRequest(req, user.id);
  } finally {
    closeUploadSlot(user.id);
  }
}

async function submitBookRequest(req: Request, userId: string): Promise<Response> {
  const submission = await readBookSubmission(req);

  if (submission.requestedProviderBook && searchRateLimited(userId)) {
    return json({ error: "Too many book lookups. Try again later." }, 429);
  }
  const result = await submitBook(userId, submission);
  if (!result.ok) {
    return json({ error: result.error, book: result.book }, 400);
  }
  return json(result.book);
}

function openUploadSlot(userId: string): boolean {
  const activeUploads = activeUploadsByUser.get(userId) ?? 0;
  if (activeUploads >= MAX_UPLOADS_PER_USER) return false;
  activeUploadsByUser.set(userId, activeUploads + 1);
  return true;
}

function closeUploadSlot(userId: string): void {
  const remaining = (activeUploadsByUser.get(userId) ?? 1) - 1;
  if (remaining <= 0) activeUploadsByUser.delete(userId);
  else activeUploadsByUser.set(userId, remaining);
}
