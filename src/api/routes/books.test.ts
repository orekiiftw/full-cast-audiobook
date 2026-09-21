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

const mockDb = {
  select: () => ({
    from: () => ({
      where: () => Promise.resolve([]),
    }),
  }),
  insert: () => ({
    values: () => ({
      returning: () => Promise.resolve([BOOK_ROW]),
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
  uploadFile: async () => {},
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

import { bookRoutes } from "./books";
import { dispatchRoute } from "../testSupport";
import { AuthUser } from "../../auth";

const testUser: AuthUser = {
  id: "00000000-0000-0000-0000-000000000002",
  email: "books-rate-limit@example.com",
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
