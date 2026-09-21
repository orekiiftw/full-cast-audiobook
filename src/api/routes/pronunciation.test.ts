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

let mockOtherTermsCount = 0;
let insertCalls = 0;

const mockDb = {
  select: () => ({
    from: () => ({
      where: () => Promise.resolve([{ value: mockOtherTermsCount }]),
    }),
  }),
  insert: () => ({
    values: () => {
      insertCalls++;
      return {
        onConflictDoUpdate: () => Promise.resolve([]),
      };
    },
  }),
};

mock.module("../../db", () => ({
  db: mockDb,
  pool: { connect: async () => ({ release: () => {} }), on: () => {} },
}));
mock.module("../ownership", () => ({
  ownedBook: async () => true,
}));
mock.module("../../queue", () => ({
  invalidateBookVoiceContextClusterwide: () => {},
}));

import { pronunciationRoutes } from "./pronunciation";
import { dispatchRoute } from "../route";
import { AuthUser } from "../../auth";

const testUser: AuthUser = {
  id: "00000000-0000-0000-0000-000000000010",
  email: "pron@example.com",
};

const BOOK_ID = "00000000-0000-0000-0000-000000000020";

function req(term = "Aeolus", hint = "EE-oh-lus"): Request {
  return new Request(`http://localhost/api/books/${BOOK_ID}/pronunciation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ term, phoneticHint: hint }),
  });
}

describe("pronunciation route term cap", () => {
  it("allows inserts while the book is below the 500-term cap", async () => {
    mockOtherTermsCount = 100;
    insertCalls = 0;
    const res = await dispatchRoute(pronunciationRoutes, req(), testUser);
    expect(res.status).toBe(200);
    expect(insertCalls).toBe(1);
  });

  it("rejects a NEW term once the book already has 500 other terms", async () => {
    mockOtherTermsCount = 500;
    insertCalls = 0;
    await expect(dispatchRoute(pronunciationRoutes, req(), testUser)).rejects.toThrow(/more than 500 pronunciation terms/);
    expect(insertCalls).toBe(0);
  });

  it("still allows updating an existing term at the cap boundary (other-terms count is 499)", async () => {
    mockOtherTermsCount = 499;
    insertCalls = 0;
    const res = await dispatchRoute(pronunciationRoutes, req("Aeolus", "AY-oh-lus"), testUser);
    expect(res.status).toBe(200);
    expect(insertCalls).toBe(1);
  });

  it("still rejects oversized terms before any dictionary work", async () => {
    mockOtherTermsCount = 0;
    await expect(dispatchRoute(pronunciationRoutes, req("x".repeat(201)), testUser)).rejects.toThrow(/200 characters or fewer/);
  });
});
