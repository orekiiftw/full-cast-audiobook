# Book Acquisition Architecture

## Current implementation

```text
Client -> POST /api/book-search -> ProviderRegistry -> provider -> PostgreSQL search cache
                                      |                       |
                                      |                       +-> normalized BookResult[]
                                      v
                               ranking and metadata cache

Client -> POST /api/books { providerBook } -> ingestion coordinator
  -> provider.acquire() -> validated EPUB handoff -> R2 -> EPUB parser -> existing pipeline
```

`BookProvider` is the only provider-specific boundary:

```ts
interface BookProvider {
  readonly name: string;
  search(query: SearchQuery): Promise<BookResult[]>;
  getBook(id: string): Promise<BookDetails>;
  acquire(book: BookResult): Promise<AcquiredBook>;
}
```

The registry owns provider selection, search caching, ranking, and metadata cache writes. The application only uses normalized `BookResult` values and `AcquiredBook` streams.

## Modules

- `src/acquisition/types.ts` — stable provider-neutral contracts.
- `src/acquisition/providers.ts` — provider adapters. `TorrentProvider` wraps the existing TorBox workflow; `AnnaArchiveProvider` is explicitly disabled until a vetted sidecar adapter exists.
- `src/acquisition/registry.ts` — registration, discovery, cache access, metadata persistence, and structured search logging.
- `src/acquisition/ranking.ts` — configurable weighted ranking.
- `src/acquisition/errors.ts` — typed acquisition errors and retry helper.
- `src/api/routes/bookSearch.ts` — search/details API.

## APIs

### `POST /api/book-search`

Accepts `{ title?, author?, isbn?, languages?, formats?, limit?, provider? }`. When `provider` is omitted, it searches all enabled providers. The response contains `{ results, cache, providers }`.

### `GET /api/book-search/:provider/:id`

Returns normalized provider details and refreshes the metadata cache.

### `POST /api/books`

In addition to existing upload, magnet, and title/author input, accepts a normalized `providerBook` selected from `/api/book-search`. The ingestion coordinator calls the named provider; the downstream EPUB/TTS pipeline remains provider-agnostic.

## Database cache lifecycle

- `book_search_cache` keys a provider response by normalized query and provider; rows expire at `expires_at`. TTL is `BOOK_SEARCH_CACHE_TTL_MS` (default one hour).
- `book_metadata` keys normalized detail by `(provider, provider_book_id)` and records `last_verified`.
- Search cache invalidation is TTL based. Deployment tooling may safely delete expired rows with `DELETE FROM book_search_cache WHERE expires_at <= now()`.

## Ranking

Ranking is deterministic and configured by `PREFERRED_LANGUAGES` (default `en`) and `PREFERRED_FORMATS` (default `epub`). Scores combine exact ISBN, exact/token title matches, author-token matches, preferred language/format, and sane ebook size. Extend `RankingConfig` for per-tenant policies or publisher/edition signals.

## Error and retry policy

`BookNotFoundError`, `ProviderUnavailableError`, `MirrorUnavailableError`, `RateLimitedError`, `DownloadFailedError`, `InvalidBookError`, and `UnsupportedFormatError` distinguish user-fixable versus transient failures. `withRetry` retries only errors flagged `retryable` and applies exponential backoff plus jitter. Invalid metadata and unsupported formats are not retried.

## Anna's Archive assessment

The `annas-archive-api` Rust crate is unofficial, while Narratea is a Bun/TypeScript service. It cannot be linked directly, and public search/download HTML and mirror links are not a stable API contract. The current `AnnaArchiveProvider` intentionally fails closed until a separately deployed, vetted adapter is configured. A production adapter should provide its own service contract, enforce rate limits and source terms, return only normalized metadata/mirrors, validate redirects/content type/size, and never expose raw provider objects to Narratea.

## Production rollout

1. Apply `drizzle/0002_book_acquisition.sql`.
2. Enable only reviewed providers via `BOOK_PROVIDERS_ENABLED=torrent` (or add `anna-archive` only when a real adapter replaces the disabled stub).
3. Add counters around the structured `provider_search` event for search counts, cache hit/miss, duration, and failures.
4. Keep current maximum-size and EPUB parser validation. Before enabling third-party direct downloads, move `AcquiredBook.stream` into a disk/R2 multipart streaming uploader so files are never materialized in worker memory.
5. ~~Move the current in-process pipeline to durable BullMQ/Redis workers before multi-instance deployment~~ **Done**: ingestion, segment voicing, and chapter stitching are BullMQ jobs (`src/queue.ts`) with acquisition references persisted before enqueueing (uploads land in storage and are referenced via `books.epubR2Key`). Postgres remains the system of record for pipeline state; Redis owns scheduling, retries, and cross-instance distribution.

## Extension path

Google Books, Open Library, Internet Archive, LibGen, Project Gutenberg, upload, and direct-URL sources only need a `BookProvider` implementation and registry registration. No search caller, ranking caller, API consumer, or EPUB worker should change.
