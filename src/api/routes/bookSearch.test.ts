import { describe, expect, it, mock } from "bun:test";

const mockDb = {
  select: () => ({
    from: () => ({
      where: () => Promise.resolve([]),
    }),
  }),
  insert: () => ({
    values: () => ({
      onConflictDoUpdate: () => Promise.resolve([]),
    }),
  }),
};

mock.module("../../db", () => ({
  db: mockDb,
  pool: { connect: async () => ({ release: () => {} }), on: () => {} },
}));

import { bookSearchRoutes } from "./bookSearch";
import { dispatchRoute } from "../testSupport";
import { AuthUser } from "../../auth";

const testUser: AuthUser = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "test@example.com",
};

describe("book search routes", () => {
  it("searches enabled providers and returns results", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("advancedsearch.php")) {
        return new Response(
          JSON.stringify({
            response: {
              docs: [
                {
                  identifier: "godan-archive-test",
                  title: "Godan",
                  creator: "Munshi Premchand",
                  year: 1936,
                  language: "hi",
                },
              ],
            },
          }),
        );
      }
      return new Response("Not found", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const req = new Request("http://localhost/api/book-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Godan", author: "Premchand", provider: "archive-org" }),
      });

      const res = await dispatchRoute(bookSearchRoutes, req, testUser);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.results).toHaveLength(1);
      expect(data.results[0].id).toBe("godan-archive-test");
      expect(data.results[0].provider).toBe("archive-org");
      expect(data.results[0].title).toBe("Godan");
      expect(data.providers).toContain("archive-org");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("answers inside the budget and marks the slow provider pending", async () => {
    const originalFetch = globalThis.fetch;
    const originalBudget = process.env.BOOK_SEARCH_BUDGET_MS;
    process.env.BOOK_SEARCH_BUDGET_MS = "1000";

    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("advancedsearch.php")) {
        return new Response(
          JSON.stringify({
            response: {
              docs: [{ identifier: "godan-archive-test", title: "Godan", creator: "Munshi Premchand" }],
            },
          }),
        );
      }
      if (urlStr.includes("gutendex.com")) return new Promise<Response>(() => {});
      return new Response("Not found", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const req = new Request("http://localhost/api/book-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Godan", author: "Premchand" }),
      });

      const started = performance.now();
      const res = await dispatchRoute(bookSearchRoutes, req, testUser);
      const elapsed = performance.now() - started;
      expect(res.status).toBe(200);
      expect(elapsed).toBeLessThan(3_000);

      const data = await res.json();
      expect(data.results.length).toBeGreaterThan(0);
      expect(data.partial).toBe(true);
      expect(data.pending).toEqual(["gutenberg"]);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalBudget === undefined) delete process.env.BOOK_SEARCH_BUDGET_MS;
      else process.env.BOOK_SEARCH_BUDGET_MS = originalBudget;
    }
  });

  it("marks a search complete when every provider answers", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("advancedsearch.php")) {
        return new Response(JSON.stringify({ response: { docs: [{ identifier: "godan-archive-test", title: "Godan" }] } }));
      }
      return new Response("Not found", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const req = new Request("http://localhost/api/book-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Godan" }),
      });

      const res = await dispatchRoute(bookSearchRoutes, req, testUser);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.partial).toBe(false);
      expect(data.pending).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fetches book details for an archive-org item", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/metadata/godan-archive-test")) {
        return new Response(
          JSON.stringify({
            metadata: {
              title: "Godan",
              creator: "Munshi Premchand",
              language: "hi",
            },
            files: [{ name: "godan.epub", size: 1024 * 1024 }],
          }),
        );
      }
      return new Response("Not found", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const req = new Request("http://localhost/api/book-search/archive-org/godan-archive-test", {
        method: "GET",
      });

      const res = await dispatchRoute(bookSearchRoutes, req, testUser);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.id).toBe("godan-archive-test");
      expect(data.provider).toBe("archive-org");
      expect(data.title).toBe("Godan");
      expect(data.mirrors[0].url).toContain("/download/godan-archive-test/godan.epub");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
