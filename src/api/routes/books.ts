import { createHash } from "crypto";
import * as nodePath from "path";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { books, castMembers, chapters, playbackState, pronunciationDict } from "../../schema";
import {
  queueBookIngestion,
  deleteBook,
  retryFailedBook,
} from "../../orchestrator";
import { json } from "../response";
import { uploadFile, deleteFile } from "../../r2";
import { readBodyWithLimit, readJsonWithLimit, ValidationError } from "../../lib/validators";
import { requireUuid } from "../../lib/validators";
import { AuthUser } from "../../auth";
import { ownedBook } from "../ownership";
import { bookProviders, BookResult } from "../../acquisition";

const BOOK_DETAIL_RE = /^\/api\/books\/([a-f0-9-]+)$/i;
const BOOK_RETRY_RE = /^\/api\/books\/([a-f0-9-]+)\/retry$/i;
const MAX_UPLOAD_BYTES = 80 * 1024 * 1024; // 80MB
// True streamed cap for multipart bodies (file cap + form overhead). Enforced
// by counting bytes off the wire, NOT by trusting a client Content-Length.
const MAX_MULTIPART_BODY_BYTES = MAX_UPLOAD_BYTES + 1024 * 1024; // file cap + form overhead

// Length bounds for user-supplied book metadata (mirrors pronunciation/segment caps).
const MAX_TITLE_LENGTH = 500;
const MAX_AUTHOR_LENGTH = 500;
const MAX_MAGNET_LENGTH = 2048;

/** Strips directory components and null bytes so a client filename is safe to pass downstream. */
function sanitizeFilename(name: string | null | undefined): string {
  const fallback = "uploaded.epub";
  if (!name) return fallback;
  const clean = name.replace(/\0/g, "");
  const base = nodePath.basename(clean) || fallback;
  return base.toLowerCase().endsWith(".epub") ? base : fallback;
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "23505";
}

export async function registerBookRoutes(req: Request, path: string, user: AuthUser): Promise<Response | null> {
  // ----------------------------------------------------
  // GET /api/books -> Library list
  // ----------------------------------------------------
  if (path === "/api/books" && req.method === "GET") {
    const allBooks = await db.select().from(books).where(eq(books.userId, user.id)).orderBy(asc(books.createdAt));
    return json(allBooks);
  }

  // ----------------------------------------------------
  // POST /api/books -> Upload EPUB, magnet link, or torrent search
  // ----------------------------------------------------
  if (path === "/api/books" && req.method === "POST") {
    const contentType = req.headers.get("content-type") ?? "";
    let title = "";
    let author = "";
    let magnetOrHash = "";
    let providerBook: BookResult | undefined;
    let epubBuffer: Buffer | undefined;
    let filename = "uploaded.epub";

    if (contentType.includes("multipart/form-data")) {
      // Read the whole multipart body with a hard byte cap (defends against
      // clients that lie about / omit Content-Length). formData() would
      // otherwise buffer an unbounded payload into memory.
      try {
        const bodyBuffer = await readBodyWithLimit(req, MAX_MULTIPART_BODY_BYTES);
        // Hand the already-bounded bytes to the runtime's parser. Because the
        // body is now a fixed in-memory buffer, formData() cannot stream more
        // than we already counted.
        const fdReq = new Request("http://localhost/upload", {
          method: "POST",
          headers: Object.fromEntries(
            Array.from(req.headers.entries()).filter(
              ([k]) => k.toLowerCase() === "content-type"
            )
          ),
          body: new Uint8Array(bodyBuffer),
        });
        const formData = await fdReq.formData();
        title = (formData.get("title") as string) ?? "";
        author = (formData.get("author") as string) ?? "";
        magnetOrHash = (formData.get("magnet") as string) ?? "";

        const file = formData.get("file");
        if (file instanceof Blob && file.size > 0) {
          if (file.size > MAX_UPLOAD_BYTES) {
            return json(
              { error: `EPUB exceeds maximum upload size of ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB` },
              400
            );
          }
          filename = sanitizeFilename(file.name);
          if (!filename.toLowerCase().endsWith(".epub")) {
            return json({ error: "Only .epub files are accepted for upload." }, 400);
          }
          epubBuffer = Buffer.from(await file.arrayBuffer());
        }
      } catch (err) {
        if (err instanceof ValidationError) throw err;
        throw new ValidationError("Malformed multipart request body.");
      }
    } else {
      const body = (await readJsonWithLimit(req)) as Record<string, unknown>;
      title = String(body.title ?? "");
      author = String(body.author ?? "");
      magnetOrHash = String(body.magnet ?? "");
      if (body.providerBook && typeof body.providerBook === "object" && !Array.isArray(body.providerBook)) {
        providerBook = body.providerBook as BookResult;
        if (typeof providerBook.id !== "string" || typeof providerBook.provider !== "string" || typeof providerBook.title !== "string" || !Array.isArray(providerBook.authors) || typeof providerBook.format !== "string") {
          throw new ValidationError("providerBook is malformed");
        }
        // Resolve the opaque provider ID server-side. Never pass client-provided
        // mirrors, URLs, metadata, or format values into acquisition.
        providerBook = await bookProviders.getBook(providerBook.provider, providerBook.id);
        title ||= providerBook.title;
        author ||= providerBook.authors.join(", ");
      }
    }

    if (title.length > MAX_TITLE_LENGTH) throw new ValidationError(`title must be ${MAX_TITLE_LENGTH} characters or fewer`);
    if (author.length > MAX_AUTHOR_LENGTH) throw new ValidationError(`author must be ${MAX_AUTHOR_LENGTH} characters or fewer`);
    if (magnetOrHash.length > MAX_MAGNET_LENGTH) throw new ValidationError(`magnet must be ${MAX_MAGNET_LENGTH} characters or fewer`);

    if (!epubBuffer && !magnetOrHash && !providerBook && (!title || !author)) {
      return json(
        {
          error:
            "Please upload an EPUB file, supply a magnet/hash link, or provide a Title + Author.",
        },
        400
      );
    }

    const hashInput = epubBuffer ?? Buffer.from(magnetOrHash || (providerBook ? `${providerBook.provider}:${providerBook.id}` : `${title}-${author}`));
    const sourceHash = createHash("md5").update(hashInput).digest("hex");

    const existing = await db
      .select()
      .from(books)
      .where(and(eq(books.userId, user.id), eq(books.sourceHash, sourceHash)))
      .then((rows) => rows[0]);

    if (existing) {
      // Failed books with a saved EPUB can be retried instead of stuck forever
      if (existing.status === "failed" && existing.epubR2Key) {
        const result = await retryFailedBook(existing.id);
        if (!result.ok) {
          return json({ error: result.error, book: existing }, 400);
        }
        const refreshed = await db
          .select()
          .from(books)
          .where(eq(books.id, existing.id))
          .then((r) => r[0]);
        return json(refreshed);
      }

      if (existing.status === "failed") {
        return json(
          {
            error:
              "A failed book with this source already exists. Delete it from the library, then add again.",
            book: existing,
          },
          409
        );
      }

      return json(existing);
    }

    let newBook;
    try {
      newBook = await db
        .insert(books)
        .values({
          userId: user.id,
          title: title || "Queued Book",
          author: author || "Queued Author",
          sourceHash,
          status: "discovering",
        })
        .returning()
        .then((rows) => rows[0]);
    } catch (error) {
      // Concurrent duplicate submission: another request won the sourceHash race
      if (isUniqueViolation(error)) {
        const raced = await db
          .select()
          .from(books)
          .where(and(eq(books.userId, user.id), eq(books.sourceHash, sourceHash)))
          .then((rows) => rows[0]);
        if (raced) return json(raced);
      }
      throw error;
    }

    // Persist before enqueue: the ingestion job carries no buffers (job
    // payloads must be small and serializable), so an uploaded EPUB is stored
    // first and the worker loads it via books.epubR2Key. This also makes the
    // ingestion crash-resumable through the normal retry path. The response
    // now waits for the storage write (~seconds for a large file).
    let epubR2Key: string | undefined;
    try {
      if (epubBuffer) {
        epubR2Key = `books/${newBook.id}/original.epub`;
        await uploadFile(epubR2Key, epubBuffer, "application/epub+zip");
        await db.update(books).set({ epubR2Key }).where(eq(books.id, newBook.id));
      }

      if (epubBuffer) {
        await queueBookIngestion(newBook.id, {});
      } else if (providerBook) {
        await queueBookIngestion(newBook.id, { providerBook });
      } else if (magnetOrHash) {
        await queueBookIngestion(newBook.id, { magnetOrHash });
      } else {
        await queueBookIngestion(newBook.id, { torrentQuery: { title, author } });
      }
    } catch (err) {
      // Don't leave a permanently stuck "discovering" row (or orphaned file)
      // behind when storage or the queue is unavailable.
      if (epubR2Key) await deleteFile(epubR2Key).catch(() => {});
      await db.delete(books).where(eq(books.id, newBook.id)).catch(() => {});
      throw err;
    }

    void filename; // sanitized for future cover/log use
    // Return the post-persist row so clients see epubR2Key when set.
    const refreshed = await db.select().from(books).where(eq(books.id, newBook.id)).then((r) => r[0]);
    return json(refreshed ?? newBook);
  }

  // ----------------------------------------------------
  // POST /api/books/:id/retry
  // ----------------------------------------------------
  const retryMatch = path.match(BOOK_RETRY_RE);
  if (retryMatch && req.method === "POST") {
    const bookId = requireUuid(retryMatch[1], "bookId");
    if (!(await ownedBook(user.id, bookId))) return json({ error: "Book not found" }, 404);
    const result = await retryFailedBook(bookId);
    if (!result.ok) {
      return json({ error: result.error }, 400);
    }
    const book = await db.select().from(books).where(eq(books.id, bookId)).then((r) => r[0]);
    return json(book);
  }

  // ----------------------------------------------------
  // DELETE /api/books/:id
  // ----------------------------------------------------
  const detailMatch = path.match(BOOK_DETAIL_RE);
  if (detailMatch && req.method === "DELETE") {
    const bookId = requireUuid(detailMatch[1], "bookId");
    if (!(await ownedBook(user.id, bookId))) return json({ error: "Book not found" }, 404);
    const deleted = await deleteBook(bookId);
    if (!deleted) {
      return json({ error: "Book not found" }, 404);
    }
    return json({ success: true });
  }

  // ----------------------------------------------------
  // GET /api/books/:id -> Book details + segment progress
  // ----------------------------------------------------
  if (detailMatch && req.method === "GET") {
    const bookId = requireUuid(detailMatch[1], "bookId");
    const book = await ownedBook(user.id, bookId);
    if (!book) {
      return json({ error: "Book not found" }, 404);
    }

    const [cast, chapterRows, pronunciation, playback] = await Promise.all([
      db
        .select()
        .from(castMembers)
        .where(eq(castMembers.bookId, bookId))
        .orderBy(asc(castMembers.name)),
      db
        .select()
        .from(chapters)
        .where(eq(chapters.bookId, bookId))
        .orderBy(asc(chapters.chapterIndex)),
      db.select().from(pronunciationDict).where(eq(pronunciationDict.bookId, bookId)),
      // Most recently updated row = where the listener actually stopped
      db
        .select()
        .from(playbackState)
        .where(eq(playbackState.bookId, bookId))
        .orderBy(desc(playbackState.updatedAt))
        .limit(1)
        .then((rows) => rows[0]),
    ]);

    // Progress comes from the chapters' atomic terminal counters — the
    // pipeline keeps totalCount/voicedCount exact per segment completion and
    // resumePendingWork() recomputes them from ground truth at boot. The old
    // implementation fetched EVERY segment row of the book (up to 100k rows)
    // on each detail load just to recompute these two counts per chapter.
    const segmentProgress: Record<string, { total: number; done: number }> = {};
    for (const ch of chapterRows) {
      segmentProgress[ch.id] = { total: ch.totalCount, done: ch.voicedCount };
    }

    return json({
      book,
      cast,
      chapters: chapterRows,
      pronunciation,
      playbackState: playback ?? null,
      segmentProgress,
      canRetry: book.status === "failed" && !!book.epubR2Key,
    });
  }

  return null;
}
