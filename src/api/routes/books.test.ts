import { describe, expect, it, mock } from "bun:test";

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

const BOOK_ID = "00000000-0000-0000-0000-000000000099";
const BOOK_ROW = {
  id: BOOK_ID,
  userId: "00000000-0000-0000-0000-000000000002",
  title: "Queued Book",
  author: "Queued Author",
  sourceHash: "x",
  status: "discovering",
  createdAt: new Date(),
};

let getBookCalls = 0;

const dbCalls: string[] = [];

const insertedBooks: Array<{ userId: string; sourceHash: string }> = [];

const uploadedFiles: Array<{ key: string; body: Buffer }> = [];

const mockDb = {
  select: () => ({
    from: () => ({
      where: () => {
        dbCalls.push("select");
        return Promise.resolve([]);
      },
    }),
  }),
  insert: () => ({
    values: (values: { userId: string; sourceHash: string }) => ({
      returning: () => {
        dbCalls.push("insert");
        insertedBooks.push(values);
        return Promise.resolve([BOOK_ROW]);
      },
    }),
  }),
  update: () => ({
    set: () => ({
      where: () => Promise.resolve([]),
    }),
  }),
  delete: () => ({
    where: () => Promise.resolve([]),
  }),
};

mock.module("../../db", () => ({
  db: mockDb,
  pool: { connect: async () => ({ release: () => {} }), on: () => {} },
}));
mock.module("../../orchestrator", () => ({
  queueBookIngestion: async () => {},
  deleteBook: async () => {},
  retryFailedBook: async () => ({ ok: false, error: "not in test path" }),
}));
mock.module("../../storage/r2", () => ({
  uploadFile: async (key: string, body: Buffer) => {
    uploadedFiles.push({ key, body });
    return key;
  },
  deleteFile: async () => {},
}));
mock.module("../../acquisition", () => ({
  bookProviders: {
    getBook: async (provider: string, id: string) => {
      getBookCalls++;
      return {
        id,
        provider,
        title: "Mocked Provider Book",
        authors: ["Mock Author"],
        format: "epub",
        language: undefined,
        mirrors: [],
      };
    },
    search: async () => ({ results: [] }),
    searchAll: async () => [],
    enabled: () => ["mock"],
  },
}));

import { createHash } from "crypto";
import { bookRoutes } from "./books";
import { dispatchRoute } from "../testSupport";
import { AuthUser } from "../../auth";

const testUser: AuthUser = {
  id: "00000000-0000-0000-0000-000000000002",
  email: "books-rate-limit@example.com",
};

const otherUser: AuthUser = {
  id: "00000000-0000-0000-0000-000000000003",
  email: "books-other-uploader@example.com",
};

function providerBookReq(n: number): Request {
  return new Request("http://localhost/api/books", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      providerBook: {
        id: `provider-book-${n}`,
        provider: "mock",
        title: `Book ${n}`,
        authors: ["Mock Author"],
        format: "epub",
      },
    }),
  });
}

describe("POST /api/books provider lookup throttling", () => {
  it("applies the shared searchRateLimited per-user throttle (60/15min) before getBook", async () => {
    getBookCalls = 0;
    for (let i = 0; i < 60; i++) {
      const res = await dispatchRoute(bookRoutes, providerBookReq(i), testUser);
      expect(res.status).toBe(200);
    }
    const throttled = await dispatchRoute(bookRoutes, providerBookReq(60), testUser);
    expect(throttled.status).toBe(429);
    expect(getBookCalls).toBe(60);
  });
});

describe("POST /api/books database round trips", () => {
  it("creates a new title-only book with a single insert and no extra reads", async () => {
    const form = new FormData();
    form.append("title", "The Time Machine");
    form.append("author", "H. G. Wells");
    dbCalls.length = 0;

    const res = await dispatchRoute(bookRoutes, new Request("http://localhost/api/books", { method: "POST", body: form }), testUser);

    expect(res.status).toBe(200);
    expect(((await res.json()) as { id: string }).id).toBe(BOOK_ID);
    expect(dbCalls).toEqual(["insert"]);
  });
});

function epubBytes(size: number): Buffer {
  const bytes = Buffer.alloc(size, 7);
  bytes.writeUInt32LE(0x04034b50, 0);
  return bytes;
}

function uploadRequest(file: Buffer): Request {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(file)], "book.epub", { type: "application/epub+zip" }));
  return new Request("http://localhost/api/books", { method: "POST", body: form });
}

function streamedUpload(contentType: string, pull: (controller: ReadableStreamDefaultController<Uint8Array>) => unknown): Request {
  const body = new ReadableStream<Uint8Array>({ pull: async (controller) => void (await pull(controller)) });
  return new Request("http://localhost/api/books", { method: "POST", headers: { "Content-Type": contentType }, body });
}

async function heldUpload(): Promise<{ req: Request; release: () => void }> {
  const serialized = uploadRequest(epubBytes(64));
  const contentType = serialized.headers.get("content-type") ?? "";
  const raw = new Uint8Array(await serialized.arrayBuffer());
  let release = () => {};
  const released = new Promise<void>((resolve) => (release = resolve));
  let pulls = 0;
  const req = streamedUpload(contentType, async (controller) => {
    if (pulls++ === 0) return controller.enqueue(raw.subarray(0, 10));
    await released;
    controller.enqueue(raw.subarray(10));
    controller.close();
  });
  return { req, release };
}

describe("POST /api/books multipart uploads", () => {
  it("stores the uploaded EPUB bytes and dedupes on their sha256", async () => {
    const epub = epubBytes(4096);
    uploadedFiles.length = 0;
    insertedBooks.length = 0;

    const res = await dispatchRoute(bookRoutes, uploadRequest(epub), testUser);

    expect(res.status).toBe(200);
    expect(uploadedFiles.map(({ key }) => key)).toEqual([`books/${BOOK_ID}/original.epub`]);
    expect(uploadedFiles[0].body.equals(epub)).toBe(true);
    expect(insertedBooks[0].sourceHash).toBe(createHash("sha256").update(epub).digest("hex"));
  });

  it("rejects an upload that is not a ZIP archive", async () => {
    await expect(dispatchRoute(bookRoutes, uploadRequest(Buffer.from("plain text, not an EPUB")), testUser)).rejects.toThrow(
      "not a valid EPUB",
    );
  });

  it("stops reading an upload as soon as the file passes 80MB", async () => {
    const boundary = "size-cap-boundary";
    const header = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="huge.epub"\r\n\r\n`);
    const chunk = Buffer.alloc(256 * 1024, 0x61);
    let pulledBytes = 0;
    const req = streamedUpload(`multipart/form-data; boundary=${boundary}`, (controller) => {
      const next = pulledBytes === 0 ? header : chunk;
      pulledBytes += next.length;
      controller.enqueue(next);
    });

    await expect(dispatchRoute(bookRoutes, req, testUser)).rejects.toThrow("EPUB exceeds maximum upload size of 80MB");
    expect(pulledBytes).toBeLessThan(81 * 1024 * 1024);
  });

  it("allows two uploads in flight per user and answers 429 to a third", async () => {
    const first = await heldUpload();
    const second = await heldUpload();
    const third = await heldUpload();
    const firstResponse = dispatchRoute(bookRoutes, first.req, testUser);
    const secondResponse = dispatchRoute(bookRoutes, second.req, testUser);

    expect((await dispatchRoute(bookRoutes, third.req, testUser)).status).toBe(429);
    expect((await dispatchRoute(bookRoutes, uploadRequest(epubBytes(64)), otherUser)).status).toBe(200);

    first.release();
    second.release();
    expect((await firstResponse).status).toBe(200);
    expect((await secondResponse).status).toBe(200);
    expect((await dispatchRoute(bookRoutes, uploadRequest(epubBytes(64)), testUser)).status).toBe(200);
  });

  it("frees the upload slot when a multipart request fails", async () => {
    const truncated = () =>
      new Request("http://localhost/api/books", {
        method: "POST",
        headers: { "Content-Type": "multipart/form-data; boundary=x" },
        body: '--x\r\nContent-Disposition: form-data; name="title"\r\n\r\nno closing boundary',
      });

    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(dispatchRoute(bookRoutes, truncated(), testUser)).rejects.toThrow("Malformed multipart request body.");
    }
    expect((await dispatchRoute(bookRoutes, uploadRequest(epubBytes(64)), testUser)).status).toBe(200);
  });
});
