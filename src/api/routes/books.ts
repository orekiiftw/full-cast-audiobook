import { asc, eq } from "drizzle-orm";
import { db } from "../../db";
import { books } from "../../schema";
import { deleteBook, retryFailedBook } from "../../orchestrator";
import { json } from "../response";
import { type RouteContext, type RouteTable } from "../route";
import { requireUuid } from "../../lib/validators";
import { ownedBook } from "../ownership";
import { createBook } from "./bookCreation";
import { getBookDetail } from "./bookDetail";
import { findBookById } from "./bookRecords";

export const bookRoutes: RouteTable = {
  "GET /api/books": listBooks,
  "POST /api/books": createBook,
  "POST /api/books/:bookId/retry": retryBook,
  "GET /api/books/:bookId": getBookDetail,
  "DELETE /api/books/:bookId": deleteUserBook,
};

async function listBooks({ user }: RouteContext): Promise<Response> {
  const allBooks = await db.select().from(books).where(eq(books.userId, user.id)).orderBy(asc(books.createdAt));
  return json(allBooks);
}

async function retryBook({ user, params }: RouteContext): Promise<Response> {
  const bookId = requireUuid(params.bookId, "bookId");
  if (!(await ownedBook(user.id, bookId))) return json({ error: "Book not found" }, 404);

  const result = await retryFailedBook(bookId);
  if (!result.ok) {
    return json({ error: result.error }, 400);
  }

  return json(await findBookById(bookId));
}

async function deleteUserBook({ user, params }: RouteContext): Promise<Response> {
  const bookId = requireUuid(params.bookId, "bookId");
  if (!(await ownedBook(user.id, bookId))) return json({ error: "Book not found" }, 404);

  const deleted = await deleteBook(bookId);
  if (!deleted) {
    return json({ error: "Book not found" }, 404);
  }

  return json({ success: true });
}
