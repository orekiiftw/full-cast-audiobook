import { and, eq, gt } from "drizzle-orm";
import { db } from "../db";
import { bookMetadata, bookSearchCache } from "../schema";
import { firstRow } from "../lib/query";
import { ACQUISITION } from "../lib/constants";
import { positiveEnvInt } from "../lib/env";
import { AcquisitionError } from "./errors";
import { normalizeSearchQuery, rankBooks } from "./ranking";
import { BookDetails, BookProvider, BookResult, ProviderSearchResponse, SearchQuery } from "./types";

const cacheTtlMs = positiveEnvInt("BOOK_SEARCH_CACHE_TTL_MS", 3_600_000, 60_000, 7 * 24 * 60 * 60 * 1000);

const maxResults = positiveEnvInt("BOOK_SEARCH_MAX_RESULTS", 25, 1, 100);

// A search answers with whatever the providers returned inside the budget; `pending` names the
// ones still working so a client can tell a complete answer from a partial one.
export interface SearchAggregation {
  results: BookResult[];
  partial: boolean;
  pending: string[];
  cache?: "hit" | "miss";
}

export interface SearchAllOptions {
  providers?: string[];
  budgetMs?: number;
}

export class ProviderRegistry {
  private readonly providers = new Map<string, BookProvider>();

  register(provider: BookProvider): this {
    this.providers.set(provider.name, provider);
    return this;
  }

  get(name: string): BookProvider {
    const provider = this.providers.get(name);
    if (!provider) throw new AcquisitionError(`Book provider '${name}' is not enabled.`);
    return provider;
  }

  enabled(): string[] {
    return [...this.providers.keys()];
  }

  async search(providerName: string, query: SearchQuery): Promise<ProviderSearchResponse> {
    const normalizedQuery = normalizeSearchQuery(query);
    const cached = await readCachedSearch(providerName, normalizedQuery);
    if (cached) return { results: cached, cache: "hit" };

    const provider = this.get(providerName);
    const started = performance.now();
    const results = rankAndLimit(await provider.search(boundedSearchQuery(query)), query);
    logProviderSearch(providerName, normalizedQuery, started, results.length);
    await writeCachedSearch(providerName, normalizedQuery, results);
    return { results, cache: "miss" };
  }

  async searchAll(query: SearchQuery, options: SearchAllOptions = {}): Promise<SearchAggregation> {
    const providerNames = options.providers ?? this.enabled();
    const budgetMs = options.budgetMs ?? searchBudgetMs();
    const answered = new Map<string, ProviderSearchResponse>();
    const failures = new Map<string, unknown>();
    const pending = new Set(providerNames);

    // An unknown provider name is the caller's error (a 400), not a provider that answers nothing.
    for (const provider of providerNames) this.get(provider);

    const settled = Promise.allSettled(
      providerNames.map(async (provider) => {
        try {
          answered.set(provider, await this.search(provider, query));
        } catch (error) {
          failures.set(provider, error);
        } finally {
          pending.delete(provider);
        }
      }),
    );

    await settlesWithin(settled, budgetMs);

    for (const provider of providerNames) {
      const failure = failures.get(provider);
      if (failure) logProviderFailure(provider, failure);
    }

    const single = providerNames.length === 1 ? answered.get(providerNames[0]) : undefined;
    return {
      results: rankAndLimit(
        [...answered.values()].flatMap((response) => response.results),
        query,
      ),
      partial: pending.size > 0,
      pending: providerNames.filter((provider) => pending.has(provider)),
      ...(single ? { cache: single.cache } : {}),
    };
  }

  async getBook(providerName: string, id: string): Promise<BookDetails> {
    const detail = await this.get(providerName).getBook(id);
    await upsertBookMetadata(providerName, id, detail);
    return detail;
  }
}

function boundedSearchQuery(query: SearchQuery): SearchQuery {
  return { ...query, limit: Math.min(query.limit ?? maxResults, maxResults) };
}

function rankAndLimit(results: BookResult[], query: SearchQuery): BookResult[] {
  return rankBooks(results, query).slice(0, query.limit ?? maxResults);
}

function logProviderSearch(provider: string, normalizedQuery: string, started: number, resultCount: number): void {
  console.info(
    JSON.stringify({
      event: "provider_search",
      provider,
      normalizedQuery,
      latencyMs: Math.round(performance.now() - started),
      results: resultCount,
      cache: "miss",
    }),
  );
}

function logProviderFailure(provider: string, reason: unknown): void {
  console.warn(`Book provider '${provider}' search failed:`, reason instanceof Error ? reason.message : reason);
}

function searchBudgetMs(): number {
  return positiveEnvInt("BOOK_SEARCH_BUDGET_MS", ACQUISITION.SEARCH_BUDGET_MS, 1_000, 60_000);
}

// Resolves when every provider has settled or the budget runs out, whichever comes first. Providers
// still running at the deadline keep writing their results into the cache for the next search.
async function settlesWithin(work: Promise<unknown>, budgetMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      work,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, budgetMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function readCachedSearch(provider: string, normalizedQuery: string): Promise<BookResult[] | undefined> {
  const cached = await firstRow(
    db
      .select()
      .from(bookSearchCache)
      .where(
        and(
          eq(bookSearchCache.provider, provider),
          eq(bookSearchCache.normalizedQuery, normalizedQuery),
          gt(bookSearchCache.expiresAt, new Date()),
        ),
      ),
  );
  return cached ? (cached.responseJson as BookResult[]) : undefined;
}

async function writeCachedSearch(provider: string, normalizedQuery: string, results: BookResult[]): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + cacheTtlMs);
  await db
    .insert(bookSearchCache)
    .values({
      query: normalizedQuery,
      normalizedQuery,
      provider,
      responseJson: results,
      createdAt: now,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [bookSearchCache.normalizedQuery, bookSearchCache.provider],
      set: { query: normalizedQuery, responseJson: results, createdAt: now, expiresAt },
    });
}

async function upsertBookMetadata(provider: string, providerBookId: string, detail: BookDetails): Promise<void> {
  const fields = metadataFields(detail);
  await db
    .insert(bookMetadata)
    .values({ provider, providerBookId, ...fields, lastVerified: new Date() })
    .onConflictDoUpdate({
      target: [bookMetadata.provider, bookMetadata.providerBookId],
      set: { ...fields, lastVerified: new Date() },
    });
}

function metadataFields(detail: BookDetails) {
  return {
    isbn: detail.isbn,
    title: detail.title,
    authors: detail.authors,
    language: detail.language,
    publisher: detail.publisher,
    year: detail.year,
    cover: detail.cover,
    formats: detail.formats,
    downloadInformation: { mirrors: detail.mirrors },
  };
}
