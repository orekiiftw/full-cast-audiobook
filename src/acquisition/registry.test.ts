import { afterAll, describe, expect, it, mock } from "bun:test";

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

mock.module("../db", () => ({
  db: mockDb,
  pool: { connect: async () => ({ release: () => {} }), on: () => {} },
}));

import { ProviderRegistry } from "./registry";
import type { BookProvider, BookResult } from "./types";

afterAll(() => mock.restore());

function result(id: string, provider: string): BookResult {
  return { id, provider, title: id, authors: [], format: "epub", mirrors: [] };
}

function provider(name: string, search: () => Promise<BookResult[]>): BookProvider {
  return {
    name,
    search,
    getBook: async () => {
      throw new Error("getBook is not part of a search");
    },
    acquire: async () => {
      throw new Error("acquire is not part of a search");
    },
  };
}

const hangs = (): Promise<BookResult[]> => new Promise(() => {});

describe("provider search budget", () => {
  it("returns the providers that finished and marks a hanging one pending", async () => {
    const registry = new ProviderRegistry()
      .register(provider("fast", async () => [result("fast-1", "fast")]))
      .register(provider("slow", hangs));

    const started = performance.now();
    const aggregation = await registry.searchAll({ title: "shadow slave" }, { budgetMs: 60 });
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(1_000);
    expect(aggregation.results.map((entry) => entry.id)).toEqual(["fast-1"]);
    expect(aggregation.partial).toBe(true);
    expect(aggregation.pending).toEqual(["slow"]);
  });

  it("is complete when every provider answers inside the budget", async () => {
    const registry = new ProviderRegistry()
      .register(provider("one", async () => [result("one-1", "one")]))
      .register(provider("two", async () => [result("two-1", "two")]));

    const aggregation = await registry.searchAll({ title: "shadow slave" }, { budgetMs: 1_000 });

    expect(aggregation.results.map((entry) => entry.id).sort()).toEqual(["one-1", "two-1"]);
    expect(aggregation.partial).toBe(false);
    expect(aggregation.pending).toEqual([]);
  });

  it("keeps the results found when another provider fails", async () => {
    const registry = new ProviderRegistry().register(provider("good", async () => [result("good-1", "good")])).register(
      provider("bad", async () => {
        throw new Error("The operation timed out.");
      }),
    );

    const aggregation = await registry.searchAll({ title: "shadow slave" }, { budgetMs: 1_000 });

    expect(aggregation.results.map((entry) => entry.id)).toEqual(["good-1"]);
    expect(aggregation.partial).toBe(false);
    expect(aggregation.pending).toEqual([]);
  });

  it("does not wait for the budget when the providers are quick", async () => {
    const registry = new ProviderRegistry().register(provider("fast", async () => [result("fast-1", "fast")]));

    const started = performance.now();
    await registry.searchAll({ title: "shadow slave" }, { budgetMs: 30_000 });

    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("keeps the per-provider cache marker for a single-provider search", async () => {
    const registry = new ProviderRegistry().register(provider("fast", async () => [result("fast-1", "fast")]));

    const aggregation = await registry.searchAll({ title: "shadow slave" }, { providers: ["fast"], budgetMs: 1_000 });

    expect(aggregation.cache).toBe("miss");
    expect(aggregation.partial).toBe(false);
  });

  it("rejects an unknown provider name instead of answering with nothing", async () => {
    const registry = new ProviderRegistry().register(provider("fast", async () => []));

    await expect(registry.searchAll({ title: "x" }, { providers: ["nope"], budgetMs: 1_000 })).rejects.toThrow(
      "Book provider 'nope' is not enabled.",
    );
  });
});
