import { beforeAll, describe, expect, it, mock } from "bun:test";
import { books, castMembers, chapters, playbackState, pronunciationDict } from "../../schema";
import type { RouteContext } from "../route";

class FakeRedis {
  on() {}
  set() {
    return Promise.resolve("OK");
  }
  del() {
    return Promise.resolve(0);
  }
  publish() {
    return Promise.resolve(0);
  }
  subscribe() {
    return Promise.resolve(undefined);
  }
  quit() {
    return Promise.resolve("OK");
  }
}
mock.module("ioredis", () => ({ Redis: FakeRedis, default: FakeRedis }));

const BOOK_ID = "00000000-0000-0000-0000-000000000173";

const FAILURE_REASON = {
  code: "torbox-auth" as const,
  message:
    "Your TorBox key was rejected, so torrent downloads could not start. A source sent a file that is not a readable EPUB. " +
    "Renew your TorBox key in Settings, or add this book as an EPUB upload.",
  detail: "TorBox failed to add torrent: An error occurred while verifying your token.",
};

const rowsByTable = new Map<unknown, unknown[]>();

function selectBuilder(): unknown {
  let table: unknown;
  const builder = {
    from: (selected: unknown) => {
      table = selected;
      return builder;
    },
    where: () => builder,
    orderBy: () => builder,
    limit: () => builder,
    // drizzle's query builder is a thenable; this one answers per table so the detail assembler runs for real.
    then: (resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
      Promise.resolve(rowsByTable.get(table) ?? []).then(resolve, reject),
  };
  return builder;
}

mock.module("../../db", () => ({ db: { select: selectBuilder } }));

let getBookDetail: (context: RouteContext) => Promise<Response>;

beforeAll(async () => {
  ({ getBookDetail } = await import("./bookDetail"));
});

function bookRow(): typeof books.$inferSelect {
  return {
    id: BOOK_ID,
    userId: "00000000-0000-0000-0000-000000000002",
    title: "Shadow Slave",
    author: "Guiltythree",
    coverR2Key: null,
    sourceHash: "x",
    epubR2Key: null,
    status: "failed",
    failureReason: FAILURE_REASON,
    createdAt: new Date("2026-11-25T02:00:00Z"),
  };
}

async function detail(context: { userId?: string } = {}): Promise<Record<string, unknown>> {
  rowsByTable.set(books, context.userId ? [] : [bookRow()]);
  rowsByTable.set(castMembers, []);
  rowsByTable.set(chapters, []);
  rowsByTable.set(pronunciationDict, []);
  rowsByTable.set(playbackState, []);

  const response = await getBookDetail({
    req: new Request(`http://localhost/api/books/${BOOK_ID}`),
    path: `/api/books/${BOOK_ID}`,
    params: { bookId: BOOK_ID },
    user: { id: "00000000-0000-0000-0000-000000000002", email: "owner@example.com" },
    connectionIp: "127.0.0.1",
  });
  return (await response.json()) as Record<string, unknown>;
}

describe("GET /api/books/:id failure detail", () => {
  it("returns the stored failure reason with the book", async () => {
    const body = await detail();

    const book = body.book as typeof books.$inferSelect;
    expect(book.status).toBe("failed");
    expect(book.failureReason).toEqual(FAILURE_REASON);
  });

  it("does not answer with another owner's book", async () => {
    rowsByTable.set(books, []);

    expect(await detail({ userId: "someone-else" })).toEqual({ error: "Book not found" });
  });
});
