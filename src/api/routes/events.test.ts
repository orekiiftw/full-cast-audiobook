import { describe, expect, it, mock } from "bun:test";

mock.module("../../books/ownership", () => ({
  ownedBook: async (_userId: string, bookId: string) => ({ id: bookId }),
}));

const SSE_QUERY_TOKEN = "sse-query-token-under-test";

mock.module("../../auth/sessions", () => ({
  authenticateSessionToken: async (token: string) => (token === SSE_QUERY_TOKEN ? testUser : null),
}));

import { pipelineEvents } from "../../queue";
import { eventRoutes } from "./events";
import { dispatchRoute } from "../testSupport";
import type { AuthUser } from "../../auth";

const testUser: AuthUser = {
  id: "00000000-0000-0000-0000-000000000060",
  email: "events@example.com",
};

function publish(bookId: string, type: string, fields: Record<string, unknown>): void {
  pipelineEvents.emit("progress", { bookId, type, ...fields, timestamp: Date.now() });
}

function openStream(bookId: string, query = "", user: AuthUser | null = testUser): Promise<Response> {
  const req = new Request(`http://localhost/api/books/${bookId}/events${query}`);
  return dispatchRoute(eventRoutes, req, user);
}

async function messagesOnConnect(bookId: string, { query = "", user = testUser as AuthUser | null } = {}): Promise<string[]> {
  const abort = new AbortController();
  const req = new Request(`http://localhost/api/books/${bookId}/events${query}`, { signal: abort.signal });
  const res = await dispatchRoute(eventRoutes, req, user);
  expect(res.status).toBe(200);

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let received = "";
  for (;;) {
    const chunk = await Promise.race([reader.read(), Bun.sleep(25).then(() => null)]);
    if (!chunk || chunk.done) break;
    received += decoder.decode(chunk.value);
  }
  abort.abort();

  return received
    .split("\n\n")
    .filter((block) => block.startsWith("data: "))
    .map((block) => (JSON.parse(block.slice("data: ".length)) as { message: string }).message);
}

describe("GET /api/books/:bookId/events", () => {
  it("replays the discovery stage a book announced before the client subscribed", async () => {
    const bookId = "00000000-0000-0000-0000-000000000061";
    publish(bookId, "status_change", { status: "discovering", message: "Starting ingestion pipeline..." });
    publish(bookId, "status_change", { status: "discovering", message: 'Searching torrents for "Dune"...' });
    publish(bookId, "progress_log", { message: "Searching apibay..." });
    publish(bookId, "progress_log", { message: "Searching torrents-csv..." });
    publish("00000000-0000-0000-0000-000000000069", "status_change", { status: "discovering", message: "Another book" });

    expect(await messagesOnConnect(bookId)).toEqual(['Searching torrents for "Dune"...', "Searching torrents-csv..."]);
  });

  it("authenticates a native client from the token query parameter", async () => {
    const bookId = "00000000-0000-0000-0000-000000000063";
    publish(bookId, "status_change", { status: "discovering", message: 'Searching torrents for "Dune"...' });

    expect(await messagesOnConnect(bookId, { query: `?token=${SSE_QUERY_TOKEN}`, user: null })).toEqual([
      'Searching torrents for "Dune"...',
    ]);
  });

  it("rejects an unknown token query parameter", async () => {
    const res = await openStream("00000000-0000-0000-0000-000000000064", "?token=not-a-session", null);

    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe("Authentication required");
  });

  it("rejects an unauthenticated stream with no token at all", async () => {
    expect((await openStream("00000000-0000-0000-0000-000000000065", "", null)).status).toBe(401);
  });

  it("stops replaying once the book leaves discovery", async () => {
    const bookId = "00000000-0000-0000-0000-000000000062";
    publish(bookId, "status_change", { status: "discovering", message: "Parsing EPUB spine and contents..." });
    publish(bookId, "status_change", { status: "in_progress", message: "Structuring chapters and segments..." });
    publish(bookId, "progress_log", { message: "Synthesizing segment 1, part 1 of 1..." });

    expect(await messagesOnConnect(bookId)).toEqual([]);
  });
});
