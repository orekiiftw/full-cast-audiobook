# API layer notes

Rationale for the decisions that used to live in comments across `src/api/`. Read this before changing
request parsing, the CSRF guard, rate limits, upload caps, or the segment-regeneration flow.

## Error mapping

`handleRequest` maps thrown errors in this order, and the order matters because the classes are
unrelated but the statuses are not:

| Thrown                     | Response                                      |
| -------------------------- | --------------------------------------------- |
| `ValidationError`          | 400 with the error's message                   |
| `SyntaxError` / `URIError` | 400 `Invalid request` (never the raw message)  |
| `AcquisitionError`         | 502 when `retryable`, otherwise 400            |
| anything else              | logged, then 500 `Internal server error`       |

The `SyntaxError` branch exists because `JSON.parse` and `decodeURIComponent` failures otherwise fall
into the catch-all and report 500 for what is really a malformed request. The message is deliberately
a constant: parser errors quote the offending input, which can echo secrets back to the caller.

## CSRF guard

Three independent checks, in this order:

1. `Sec-Fetch-Site: cross-site` is rejected outright, for every method including `GET`.
2. `GET`/`HEAD`/`OPTIONS` pass without an `Origin` check — they are not state-changing.
3. Unsafe methods must satisfy one of: same origin as the request URL, a loopback-to-loopback pair
   (so the Vite dev server on another local port can call the API), or an exact match against
   `CORS_ORIGIN`. A missing `Origin` header is allowed: non-browser clients do not send one, and
   they are not the threat this guard defends against.

`CORS_ORIGIN` is read at request time here but captured at module load in `response.ts`. That
asymmetry is intentional: CORS headers only need to be right at startup, while a test that flips the
variable expects the guard to notice.

## Rate limits

`createRateLimiter` implements a fixed window: the first call for a key starts the window and counts
as attempt 1, and a key trips only when its count is strictly greater than the maximum. Expired
entries are swept at most once every 60 seconds, so the maps cannot grow without bound under a
traffic flood.

Two limiters exist, both 15-minute windows:

- **Login/signup** — keyed by `pathname:connectionIp`, 10 attempts. Requests with an unknown
  connection IP are never limited, because they would all share one bucket.
- **Book search** — keyed by user id, 60 requests. `searchRateLimited` is shared deliberately: the
  provider-book lookup path of `POST /api/books` spends the same budget as `POST /api/book-search`,
  and it is charged before the provider is called, so a rejected request costs nothing upstream.

## Book creation

`POST /api/books` accepts multipart or JSON. The dedupe hash is computed from the strongest available
identity, in this order: the EPUB bytes, then the magnet/hash string, then `provider:id`, then
`title-author`. That order means re-uploading the same EPUB file and submitting the same provider book
never collide, and the hash is the only key used to detect duplicates within a user's library.

Size caps: 80 MB EPUB, 81 MB for the whole multipart envelope (the extra megabyte absorbs boundary and
field overhead), 5 MB default JSON body, 32 KB for book search.

When a duplicate is submitted and the existing row is `failed`, creation retries it rather than
returning the dead row — the user's intent was clearly to get that book processed.

Multipart parsing errors are flattened to `Malformed multipart request body.` so a parser's internal
message never reaches the client; `ValidationError`s raised by the field checks pass through intact.

## Audio streaming

`GET /api/audio` authorizes the key before touching storage. Ownership works two ways: a key under
`books/<uuid>/...` is checked by owning that book directly, and anything else is matched against the
user's own cover, EPUB, chapter-audio and segment-audio keys.

A `Range` header forces a `stat` so the total size is known; that size is then passed into
`streamFile` so the backend does not repeat the lookup. A present-but-unsatisfiable range must be 416
with `Content-Range: bytes */<size>` — answering 200 with the whole file breaks browser seeking and
wastes a full object transfer. Any storage failure collapses to 404 so the endpoint does not leak
whether an object exists.

## Segment regeneration

`POST /api/segments/:segmentId/regenerate` holds two independent guards:

- A Redis lock (`regen:<id>`, 5-minute TTL) rejects a second concurrent request with 409.
- A conditional DB claim (`status != 'processing'`) rejects a segment the pipeline worker already
  holds. Both 409s must stay: the pipeline takes segments without the regeneration lock, so the lock
  alone cannot see a worker's claim.

The chapter counters are repaired rather than recomputed. Regeneration re-voices an existing row, so
the delta depends on the previous status: `failed` decrements `failedCount` and increments
`voicedCount`, any other status increments `voicedCount`, and `voiced` reads the counters without
writing. That last case still emits `segment_ready` — the audio did change — but it produces no
`chapters` update, which is what the counter-repair test asserts on.

## Response headers

Every JSON and binary response carries `X-Content-Type-Options: nosniff` plus the
frame/referrer/permissions policy set. CORS headers are emitted only when `CORS_ORIGIN` is set.
Audio responses use a narrower set on purpose: `cache-control: private, max-age=300` and
`Accept-Ranges: bytes`, without the frame/referrer/permissions policies.

Audio URLs embed `v=<durationMs>` so a regenerated segment busts the client cache; `segmentAudioSrc`
on the client rewrites that parameter when it already exists.

## Layer note

`src/lib/` is documented as shared and environment-agnostic, but it currently holds three kinds of
module:

- **Environment-agnostic**: `constants`, `language`, `query`, `segmentPatch`, `segmentStatus`,
  `validators`, and the duration/URL formatting half of `format`.
- **Server-only**: `readStream` (uses `Buffer` and web streams) — imported by `acquisition`,
  `torrent`, `storage`, `orchestrator`, `narration/tts` and `api`.
- **Browser-only**: `api` (`window`), `sessionHint` (`localStorage`), `sharedAudio` (`Audio`), and the
  UI-facing helpers in `format`, `segmentPatch` and `segmentStatus`.

Splitting the browser-only helpers out of `lib/` would require editing their importers in
`components/`, `hooks/` and `App.tsx`, which this pass does not own. `src/lib/` and `src/api/` also
have no `index.ts` barrel; adding one would leave it unused until every importer is rewritten.
