import { assembleBookDetail } from "../../books";
import { json } from "../response";
import type { RouteContext } from "../route";
import { requireUuid } from "../../lib/validators";
import { ownedBook } from "../../books/ownership";

export async function getBookDetail({ user, params }: RouteContext): Promise<Response> {
  const bookId = requireUuid(params.bookId, "bookId");
  const book = await ownedBook(user.id, bookId);
  if (!book) {
    return json({ error: "Book not found" }, 404);
  }

  return json(await assembleBookDetail(book, bookId));
}
