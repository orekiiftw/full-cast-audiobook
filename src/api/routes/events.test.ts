import { describe, expect, it, mock } from "bun:test";

mock.module("../../books/ownership", () => ({
  ownedBook: async (_userId: string, bookId: string) => ({ id: bookId }),
}));

import { pipelineEvents } from "../../queue";
import { eventRoutes } from "./events";
import { dispatchRoute } from "../testSupport";
import { AuthUser } from "../../auth";

const testUser: AuthUser = {
  id: "00000000-0000-0000-0000-000000000060",
  email: "events@example.com",
};

function publish(bookId: string, type: string, fields: Record<string, unknown>): void {
  pipelineEvents.emit("progress", { bookId, type, ...fields, timestamp: Date.now() });
}

async function messagesOnConnect(bookId: string): Promise<string[]> {
  const abort = new AbortController();
  const req = new Request(`http://localhost/api/books/${bookId}/events`, { signal: abort.signal });
  const res = await dispatchRoute(eventRoutes, req, testUser);
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

  it("stops replaying once the book leaves discovery", async () => {
    const bookId = "00000000-0000-0000-0000-000000000062";
    publish(bookId, "status_change", { status: "discovering", message: "Parsing EPUB spine and contents..." });
    publish(bookId, "status_change", { status: "in_progress", message: "Structuring chapters and segments..." });
    publish(bookId, "progress_log", { message: "Synthesizing segment 1, part 1 of 1..." });

    expect(await messagesOnConnect(bookId)).toEqual([]);
  });
});
