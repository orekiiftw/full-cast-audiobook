import { and, eq, gt } from "drizzle-orm";
import { db } from "../db";
import { bookMetadata, bookSearchCache } from "../schema";
import { firstRow } from "../lib/query";
import { AcquisitionError } from "./errors";
import { normalizeSearchQuery, rankBooks } from "./ranking";
import { BookDetails, BookProvider, BookResult, ProviderSearchResponse, SearchQuery } from "./types";

function positiveEnvInt(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

const cacheTtlMs = positiveEnvInt("BOOK_SEARCH_CACHE_TTL_MS", 3_600_000, 60_000, 7 * 24 * 60 * 60 * 1000);
const maxResults = positiveEnvInt("BOOK_SEARCH_MAX_RESULTS", 25, 1, 100);

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

  async searchAll(query: SearchQuery): Promise<BookResult[]> {
    const providerNames = this.enabled();
    const settled = await Promise.allSettled(providerNames.map((provider) => this.search(provider, query)));
    settled.forEach((result, index) => logProviderFailure(providerNames[index], result));
    return rankAndLimit(
      settled.flatMap((result) => (result.status === "fulfilled" ? result.value.results : [])),
      query,
    );
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

function logProviderFailure(provider: string, result: PromiseSettledResult<ProviderSearchResponse>): void {
  if (result.status === "fulfilled") return;
  console.warn(`Book provider '${provider}' search failed:`, result.reason instanceof Error ? result.reason.message : result.reason);
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
