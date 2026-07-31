import { and, eq, gt } from "drizzle-orm";
import { db } from "../db";
import { bookMetadata, bookSearchCache } from "../schema";
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
  register(provider: BookProvider): this { this.providers.set(provider.name, provider); return this; }
  get(name: string): BookProvider {
    const provider = this.providers.get(name);
    if (!provider) throw new AcquisitionError(`Book provider '${name}' is not enabled.`);
    return provider;
  }
  enabled(): string[] { return [...this.providers.keys()]; }

  async search(providerName: string, query: SearchQuery): Promise<ProviderSearchResponse> {
    const normalizedQuery = normalizeSearchQuery(query);
    const cached = await db.select().from(bookSearchCache).where(and(eq(bookSearchCache.provider, providerName), eq(bookSearchCache.normalizedQuery, normalizedQuery), gt(bookSearchCache.expiresAt, new Date()))).then((r) => r[0]);
    if (cached) return { results: cached.responseJson as BookResult[], cache: "hit" };
    const provider = this.get(providerName);
    const started = performance.now();
    const results = rankBooks(await provider.search({ ...query, limit: Math.min(query.limit ?? maxResults, maxResults) }), query).slice(0, query.limit ?? maxResults);
    console.info(JSON.stringify({ event: "provider_search", provider: providerName, query, normalizedQuery, latencyMs: Math.round(performance.now() - started), results: results.length, cache: "miss" }));
    const now = new Date();
    await db.insert(bookSearchCache).values({ query: JSON.stringify(query), normalizedQuery, provider: providerName, responseJson: results, createdAt: now, expiresAt: new Date(now.getTime() + cacheTtlMs) }).onConflictDoUpdate({ target: [bookSearchCache.normalizedQuery, bookSearchCache.provider], set: { query: JSON.stringify(query), responseJson: results, createdAt: now, expiresAt: new Date(now.getTime() + cacheTtlMs) } });
    return { results, cache: "miss" };
  }

  async searchAll(query: SearchQuery): Promise<BookResult[]> {
    const settled = await Promise.allSettled(this.enabled().map((provider) => this.search(provider, query)));
    return rankBooks(settled.flatMap((r) => r.status === "fulfilled" ? r.value.results : []), query).slice(0, query.limit ?? maxResults);
  }

  async getBook(providerName: string, id: string): Promise<BookDetails> {
    const detail = await this.get(providerName).getBook(id);
    await db.insert(bookMetadata).values({ provider: providerName, providerBookId: id, isbn: detail.isbn, title: detail.title, authors: detail.authors, language: detail.language, publisher: detail.publisher, year: detail.year, cover: detail.cover, formats: detail.formats, downloadInformation: { mirrors: detail.mirrors }, lastVerified: new Date() }).onConflictDoUpdate({ target: [bookMetadata.provider, bookMetadata.providerBookId], set: { isbn: detail.isbn, title: detail.title, authors: detail.authors, language: detail.language, publisher: detail.publisher, year: detail.year, cover: detail.cover, formats: detail.formats, downloadInformation: { mirrors: detail.mirrors }, lastVerified: new Date() } });
    return detail;
  }
}
