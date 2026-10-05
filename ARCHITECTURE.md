# Architecture

How Narratea turns an EPUB into a performed audiobook, and the invariants that are easy to
break. `README.md` covers setup and features; this file covers why the code is shaped the way
it is. Everything here is knowledge the code cannot state on its own.

## Data flow

```
POST /api/books ──> ingestion job ──> EPUB parse ──> chapters + segments (Postgres)
                                          │
                     segment jobs ────────┘──> annotate (Gemini) ──> synthesize (TTS) ──> segment WAV
                                          │
                     chapter counters ────┴──> stitch gate ──> ffmpeg concat ──> chapter MP3
                                          │
                     SSE progress ────────┴──> client patches state in place
```

Three status machines drive everything: `books` (`discovering → casting → in_progress →
ready|failed`), `chapters` (`queued → processing → partial_ready → ready|failed`), and
`segments` (`pending → queued → processing → annotated → voiced|failed`). Postgres is the system
of record; Redis owns scheduling, retries, and cross-instance work.

## Source layout

Directory entry files (`index.ts`) expose the operations and types callers need. Provider
registration lives in `acquisition/manifest.ts`, and torrent book-download orchestration lives in
`torrent/books.ts`, rather than mixing implementation with re-exports.

Within a file, imports and re-exports come first, followed by shared types and configuration,
public operations, then private helpers. Implementation-only types sit beside their first use.
Runtime initialization keeps its dependency order; declaration order is not an excuse to change
when environment variables are captured or singletons are created. Tests stay beside the seam
they exercise.

`api/routes` owns HTTP parsing, request validation, authorization checks, and response mapping.
`books` owns ownership queries, book submission and persistence, detail assembly, chapter reads,
and playback persistence plus lookahead scheduling. `auth` owns accounts and sessions.
`narration` owns pronunciation writes and voice-preview generation, while `orchestrator/regeneration`
owns regeneration locking, synthesis, counter repair, and re-stitch scheduling. These operations
return domain data, not HTTP responses.

Cross-module primitives belong in `lib`: error messages, delays, host matching, stream conversion,
audio URLs, environment parsing, and chapter-completion checks. Storage-key construction remains
in `storage/keys.ts`. Transport-specific limits and error messages stay at their call sites;
sharing a primitive must not unify policies that intentionally differ.

## Pipeline and queue

**Job contracts.** Segment jobs: 5 attempts, exponential backoff from 5 s, `removeOnComplete`,
`priority = chapterIndex` so earlier chapters drain first. Stitch jobs: 5 attempts, fixed 60 s
backoff. Ingestion jobs: 1 attempt and removed on both outcomes — book-level retry is explicit,
never automatic. The maintenance queue repeats every 5 minutes. Concurrency is 2 ingestion,
`MAX_WORKERS_PER_BOOK` (3) segments, 2 stitch, 1 maintenance.

**Job ids are the dedupe key.** Ingestion is keyed by book id, a segment job by segment id, a
stitch job by chapter id. BullMQ silently ignores an `add` whose job id exists in any state, so
every submit calls `clearTerminalJob` first; without it, work is dropped without a trace.

**Lookahead is the TTS budget.** Only the next `LOOKAHEAD_SEGMENTS` (4) unfinished segments at or
after the listener's position get voiced eagerly; everything else stays `pending` until playback
approaches it. `ensureLookahead` re-centers on every playback sync (throttled per book+chapter for
2 s, map capped at 5000 keys), lifting queued jobs to `LOOKAHEAD_PRIORITY` and promoting pending
rows. `ensureChapterLookahead` covers chapters N and N+1 with its own 10 s window and is what fills
in the rest of a chapter when the player opens it; `prefetchNextChapter` lifts the next chapter's
jobs into the current chapter's priority band (64 per `changePriority` batch) and refuses to run
while the current chapter still has queued, processing, or annotated segments.

**Partial readiness.** A chapter becomes `partial_ready` once its first `PARTIAL_READY_THRESHOLD`
(1) segments are terminal with at least one voiced, so playback can start while voicing continues.
`maybeMarkPartialReady` never downgrades a chapter past `ready`, `partial_ready`, or `failed`. A
terminal window with nothing voiced waits for the stitch pass instead.

**Stitching and coalescing.** A chapter stitches when `voiced + failed >= total`. A re-stitch
request that arrives mid-stitch sets a Redis flag instead of queueing a second job; the running job
consumes the flag and re-runs, up to 5 reruns before one final pass drops further requests. A
chapter with no segments or no voiced segments fails rather than stitching silence.

**Sweep and recovery.** Boot runs temp-dir cleanup, chapter-counter repair, re-enqueue of `queued`
rows, then a full sweep. The 5-minute sweep re-queues orphaned mid-flight segments, re-materializes
stranded `queued` rows, refills the queue below `QUEUED_REFILL_WATERMARK` (100 jobs), enqueues
counter-terminal stitches, and fails ingestions stuck past `INGESTION_STUCK_MS`.

## Narration

**Annotation is a trust boundary.** Book text can embed model instructions — a hostile EPUB
controls the input to Gemini and receives JSON back. `normalizeAnnotation` caps every field
(`MAX_BEATS` 12, beat text 4000, delivery fields 500, scene summary 2000), clamps `intensity` into
`0..1`, validates `pace` against `slow|normal|fast`, and drops malformed beats. Delivery fields
reach only the TTS style prompt; they can never change the voiced text.

`scene_summary` is the one field that persists and gets re-fed into the next segment's prompt, so
`sanitizeSceneSummary` strips control characters and neutralizes `ignore previous|system:|assistant:
|user:|</?system>`. Known quirk kept deliberately: the pattern ends in `\b`, and `system:` ends in a
non-word character, so `system: you` slips through and only `system:x` is caught. Tightening it
changes behavior and needs its own tests.

**Alignment check.** `beatsMatchSegment` compares the concatenated beat text against the segment
after collapsing whitespace and reducing both to letters and digits. An earlier length-only check
let altered characters through, so the pipeline could voice text that did not match the page.
Whitespace, quotes, and dashes are cosmetic and ignored on purpose; letter/digit differences are
not. On failure the segment falls back to the summary plus one neutral beat carrying the original
text, so no content is lost. `NEUTRAL_BEAT_DELIVERY` is also the fallback for missing fields.

**Annotation timeout is 120 s via `AbortController`, not `Promise.race`** — racing would leave the
paid call running while the segment retried, duplicating spend. The Gemini client is cached per API
key because it is stateless config.

**TTS provider selection** is `TTS_PROVIDER` (forced) → missing `SARVAM_API_KEY` (MiMo) → Indic
language detection (Sarvam) → MiMo. Instances are cached (one MiMo, one Sarvam per BCP-47 code) so
a book does not rebuild a provider per beat. All workers of all books funnel through one semaphore
sized by `TTS_MAX_CONCURRENCY`.

**Rate limits.** On a 429 carrying `retry-after`, a process-wide cool-down is recorded and every
later attempt waits it out. `parseRetryAfterMs` accepts delta-seconds and HTTP dates and floors at
250 ms so `retry-after: 0` cannot spin. Retries cover 408/409/425/429, all 5xx, and any non-API
error (network, timeout); config and input errors never retry. Delays double from
`TTS.INITIAL_RETRY_DELAY_MS` to `TTS.MAX_RETRY_AFTER_MS`, and a 429's own header wins when shorter.

**Pronunciation hints** become word-boundary regexes with specials escaped and `$` doubled in the
replacement, compiled once per dictionary identity in a `WeakMap`.

**Beat assembly.** `mergeBeatsWithPauses` trims edge silence per beat and splices
`BEAT_GAP_MS` after sentence-ending beats, `BEAT_GAP_SOFT_MS` otherwise, plus `SEGMENT_TAIL_PAUSE_MS`
at the end — but only when every beat shares one 16-bit PCM format, so a format mismatch leaves
buffers for the ffmpeg concat fallback. The styled attempt and the neutral retry are deliberately
not the same call: the styled one sends full delivery, the sanitized `instruction`, and both `pace`
and `intensity`; the retry sends neutral style, no instruction, and only `pace`.

**Voice context** caches narrator voice, base style, dictionary, and language per book for 5
minutes (1000 books max, expired-then-oldest eviction). Language detection samples 30 segments from
25% into the book so the sample reflects body text, not front matter.

## EPUB parsing

**Decompression-bomb guard runs before `unzipSync`,** because unpacking materializes the whole
archive. It sums declared uncompressed sizes from the ZIP central directory (never trusting the
data) and rejects past the cap; a single oversized entry is rejected on its own; any ZIP64 locator,
sentinel count, or offset is rejected outright, since a 64-bit size could slip past 32-bit
arithmetic. Tests forge each shape, including one where the total-entry field is forged to 1 while
the per-disk field stays truthful.

**OPF paths and manifest hrefs are attacker-controlled.** Both are normalized and rejected if they
contain `..`, are absolute, or would resolve outside the archive. Hrefs are percent-decoded
tolerantly, stripped of `#fragment`/`?query`, and have backslashes folded to `/`.

**Metadata appears in at least three shapes** and a miss silently discards a book's identity, so
`opf.ts` tries DC elements under any prefix, EPUB2/EPUB3 `<meta name|property>` tags (creator also
matching `author`), then the parsed DOM. The literal value `unknown` counts as absent; nothing
found yields `Unknown Title`/`Unknown Author` sentinels, which OCR'd scans produce and which
ingestion treats as "absent" rather than overwriting a real title.

**Page acceptance** (`filters.ts`, ordered as in `spine.ts`): filename stems match front/back
matter as exact tokens plus longer prefixes — token-exact on purpose, since an unanchored regex
would drop real chapters like `jack.xhtml`. Heading-based front matter and `epub:type="toc"` bodies
are skipped. Structural TOC pages are navs with 4+ links (3 chapterish) or 8+ links, or lists with
5+ items where 4 look like entries and prose stays under 80 words. Block-level TOC pages use three
density rules. A TOC sharing a file with Chapter 1 gets its leading run (3+ blocks) cut. Back
matter latches only past 60% of the spine and after a book's worth of words, so a mid-book "Notes"
part cannot truncate the rest. Structural TOC skipping matters beyond structure: those pages would
otherwise be narrated aloud as story.

**Chapter aggregation.** The first accepted page becomes Chapter 1, so it must be the real start. A
page qualifies on a prologue/chapter/volume/part/book heading, a chapter/part filename, or 400+
non-front-matter words. Pages that pass the filters but not the gate are **held**, not dropped, and
promoted in spine order only when nothing ever tripped the gate — an OCR'd EPUB split into
per-page files would otherwise be rejected wholesale. A spine whose median file is page-sized is a
scan split per page, so pages merge until 2500 words; a spine of chapter-sized files keeps one
chapter each. A page with a heading always opens a chapter, and a chapter never breaks
mid-sentence: the page continuing a sentence joins it. Hitting the chapter cap fails the parse
rather than truncating.

**Text and blocks.** `cleanText` collapses whitespace, strips `[12]` citation markers, and
normalizes smart quotes. Blocks are `<p>`, `<h1>`–`<h6>`, and `<blockquote>`; scripts, styles,
images, page-break markers, and linked footnote superscripts are removed first. Under 60 characters
and equal to the book title is a running header; bare page numbers are dropped. Headings come from
`<h1>`–`<h3>`, but many EPUBs use `<p class="partTitle">`, so any element whose class matches
`title` or `head` counts (under 120 chars, never the bare book title).

## Acquisition

`BookProvider` (`search` / `getBook` / `acquire`) is the only provider-specific boundary. The
registry owns selection, search caching, ranking, and metadata writes; callers only ever see
normalized `BookResult`s and `AcquiredBook` streams. Adding a source means one provider file plus a
manifest entry — no caller changes.

**Search cache** keys a provider response by normalized query and provider under
`BOOK_SEARCH_CACHE_TTL_MS` (default 1 h) and is TTL-invalidated; `book_metadata` keys details by
`(provider, provider_book_id)` with `last_verified`. Both live in Postgres so instances share them.

**Ranking** is deterministic and configured by `PREFERRED_LANGUAGES` (default `en`) and
`PREFERRED_FORMATS` (default `epub`): exact ISBN, exact and token title matches, author tokens,
language, format, plus a sane-size signal.

**Errors distinguish user-fixable from transient.** `ProviderUnavailableError` is retryable,
`BookNotFoundError` and `UnsupportedFormatError` are not. The API maps retryable acquisitions to
502, the rest to 400.

**Mirror URLs come from third-party metadata, so every download allow-lists the host before
fetching a byte and a redirect can never widen the allow-list.** Archive.org accepts `https:` on
`archive.org` or any subdomain (its CDN serves from `ia801234.us.archive.org`, which is why
subdomains are allowed); JSON calls cap at 3 redirect hops and downloads at 5, each hop
re-validated. Gutenberg accepts `gutenberg.org` only and follows redirects natively, so only the
initial URL is checked. LibGen URLs are assembled from its own base plus a scraped md5 and key, so
no user-supplied host ever reaches the request. A malformed URL and a valid-but-untrusted host
produce different errors on purpose.

**Archive.org** excludes lending-restricted collections in the search filter
(`-collection:(inlibrary) -collection:(printdisabled)`), without which hits resolve to items only
borrowers can open. Free text is sanitized to letters, marks, numbers, and whitespace because the
query syntax treats other punctuation as operators. Title+author is tried before title alone,
since transliterated author names often miss. LCP-encrypted `.epub` files are skipped — they are
DRM and unreadable by the parser.

**Gutenberg** drops entries without an `application/epub+zip` format rather than downgrading, and
sends a browser user agent because Gutendex rejects default agents.

**LibGen has no JSON API**: rows are split on `<tr` and only usable with an `ads.php?md5=<hex>`
link, 8+ cells, and a non-empty title once the `<i>` edition note is removed; the format cell is
whichever cell text is exactly one of `epub pdf mobi azw3 djvu fb2`; size comes from the `file.php`
cell. Downloads are two-step (`ads.php` → `get.php?md5&key`), and because LibGen answers some
failures with an HTML page at HTTP 200, a `text/html` content type on the file response is treated
as a provider failure with the first 160 characters surfaced.

**Fallback acquisition** (`fetchEpubFromArchiveOrg` / `FromGutenberg` / `FromLibgen`) runs when
torrents find nothing: search, rank, then take the first result passing all three gates — over
5000 bytes, a real ZIP container, and for items claiming an Indic language, text actually in that
script. The script check exists because metadata language claims are frequently wrong for Indic
titles, where a wrong edition leaves Latin text behind while the metadata still says `hin`.

**Anna's Archive stays disabled.** The only available client is an unofficial Rust crate that
cannot link into a Bun/TypeScript service, and its public HTML is not a stable contract. A real
adapter would need its own service boundary, rate limits, and normalized output.

## Torrent and IPFS

**CDN host allow-list.** `assertSafeDownloadUrl` accepts `torbox.app`, `tb-cdn.pw`, `tb-cdn.io`
and their subdomains because TorBox hands out per-region hosts like `nexus-008.indi.tb-cdn.pw`.
Matching is on `hostname` equality or `.`-suffix, never substring: `tb-cdn.pw.evil.com` and
`evil.com/?x=tb-cdn.pw` must both fail.

**Redirect budgets** are 3 hops for the TorBox API, 5 for the CDN, 3 for IPFS gateways; every hop
is re-validated, and the CDN and IPFS paths re-run DNS validation per hop. The IPFS flow tolerates
one escape hatch: a redirect keeping the same hostname and protocol passes even when not `https:`,
because the catalogue VPS may sit behind a plain-HTTP reverse proxy.

**DNS is cached process-wide for 30 s**, re-inserted on hit to stay roughly LRU and trimmed past
100 entries. Each CDN redirect hop re-resolves, so caching avoids paying DNS per hop while the
short TTL still lets a real change through.

**Caps.** TorBox JSON 32 MB, error bodies 64 KB, downloads 200 MB (checked from `content-length`
and again while streaming). Search gets 2 attempts with a 750 ms pause; unreachable, 401/403/404,
and a `0 per ...` quota message trip a process-wide circuit breaker and fall through to the
fallback indexers. Liveness probing is capped at 5 hashes per search. Downloads poll 60 times for a
cached torrent, 12 for an uncached one, at 10 s intervals.

**Indexers and queries.** TorBox search (only the first variant, since it is the metered one),
apibay (`cat=601`), then torrents-csv (`size=25`). Up to five `... epub` query variants — full
author, surname, title-only, keyword fallbacks — after NFKC normalization; punctuation stripping is
what keeps non-Latin titles alive, since a variant reducing to nothing is dropped.

**Ranking** rewards `.epub` names (+50) and seeders (`min(seeds, 50)`), punishes PDF (−20), mobi/azw
(−5), and audio (−40), adds +8 per title token and +4 per author token, and biases toward plausible
sizes (+10 under 20 MB, −10 over 50 MB). A hit survives only if its name mentions epub, every title
token matches, and the score is positive. Candidates order cached > alive > unknown > dead, then
seeders, then name.

**Cold editions.** A candidate is cold when `cached === false && alive === false`. Cold candidates
skip TorBox only while a healthier one remains ahead; when everything is cold the best-ranked is
attempted anyway. IPFS is tried first for cold candidates and as a fallback after any TorBox
failure, preferring the self-hosted catalogue node over the public gateways. Cold candidates send
`add_only_if_cached=true` so TorBox itself refuses a download that cannot finish.

**Verification.** `selectTorrentFile` prefers a file named after the expected md5 (normalizing away
non-hex so `.epub.gz` still matches), else the first exact `.epub` skipping samples and `.epub.txt`
decoys. Every buffer is rejected if it starts with `%PDF` or carries a `.pdf` name and must pass
the ZIP magic test.

## API layer

**Error mapping order matters** because the classes are unrelated but the statuses are not:
`ValidationError` → 400 with its message; `SyntaxError`/`URIError` → 400 `Invalid request`; the
`AcquisitionError` branch → 502 when retryable else 400; anything else → logged and 500. The syntax
branch exists so malformed JSON does not report 500, and its message is a constant because parser
errors quote the offending input, which can echo secrets back.

**CSRF guard** checks in order: `Sec-Fetch-Site: cross-site` is rejected for every method
including `GET`; safe methods pass without an origin check; unsafe methods must be same-origin, a
loopback-to-loopback pair (so the Vite dev server can call the API), or an exact `CORS_ORIGIN`
match. A missing `Origin` is allowed — non-browser clients do not send one and are not the threat.
`CORS_ORIGIN` is read per request here but captured at module load in `response.ts`; that asymmetry
is intentional, since headers only need to be right at startup while tests flip the variable.

**Rate limits** are fixed windows: the first call starts the window and counts as attempt 1, and a
key trips only when its count exceeds the maximum; entries are swept at most once a minute.
Login/signup is keyed by `pathname:connectionIp` at 10 attempts, and requests with an unknown
connection IP are never limited, since they would share one bucket. Book search is keyed by user id
at 60 requests; `searchRateLimited` is shared deliberately, because `POST /api/books` with a
provider book spends the same budget, and it is charged before the provider is called so a rejected
request costs nothing upstream.

**Book creation** accepts multipart or JSON; the dedupe hash uses the strongest identity available
in order — EPUB bytes, magnet/hash, `provider:id`, then `title-author` — so re-uploading a file and
submitting the same provider book never collide. Caps: 80 MB EPUB, 81 MB multipart envelope (the
extra megabyte absorbs boundary overhead), 5 MB JSON, 32 KB search. A duplicate whose existing row
is `failed` is retried rather than returned dead, since the user's intent was clearly to process
it. Multipart parser errors are flattened to one constant message so internals never leak.

**Audio streaming** authorizes before touching storage: keys under `books/<uuid>/` are checked by
owning that book, anything else against the user's own cover, EPUB, chapter-audio, and segment-audio
keys. A `Range` header forces a `stat` whose size is then passed into `streamFile` to avoid a second
lookup. An unsatisfiable range must be 416 with `Content-Range: bytes */<size>` — answering 200 with
the whole file breaks browser seeking. Any storage failure collapses to 404 so the endpoint does not
reveal whether an object exists.

**Segment regeneration holds two independent guards**: a Redis lock (`regen:<id>`, 5 min TTL)
rejects a concurrent request, and a conditional DB claim (`status != 'processing'`) rejects a
segment a pipeline worker already holds. Both are needed — the pipeline takes segments without the
lock, so the lock alone cannot see a worker's claim. Counters are repaired rather than recomputed,
because re-voicing an existing row makes the delta depend on the previous status: `failed`
decrements `failedCount` and increments `voicedCount`, anything else increments `voicedCount`, and
`voiced` reads without writing but still emits `segment_ready` since the audio did change.

## Audio and storage

**WAV invariants.** `parseWav` walks chunks from offset 12, requires `fmt ` (16+ bytes) and a
`data` chunk, skips unknown chunks and the pad byte after odd sizes, and never trusts the RIFF size
field — a chunk whose declared size runs past the buffer raises `Truncated WAV chunk`. Silence
trimming only understands 16-bit PCM and measures audibility in 10 ms windows against 0.015 of full
scale, keeping `keepMs` past the last audible window.

**Local fallback layout** maps keys under `./.storage/` relative to the cwd at module load, using
the URL-encoded key as filename and sharding to `<sha256[0..2]>/<sha256[2..4]>/<sha256>_<last 100
chars>` past 200 characters. Uploads write a temp file and rename so readers never see a partial
object, and `localPathForKey` rejects any key whose resolved path escapes the root.

**Ranged streaming.** `resolveRange` accepts `bytes=start-end`, `bytes=start-`, and `bytes=-suffix`,
returning `null` for malformed or unsatisfiable input (the route turns that into 416); suffix
lengths past the object size clamp to 0. `partial: true` only when a range was requested and fewer
bytes than the object holds are served, and a `knownSize` hint avoids a second stat/HEAD. Downloads
are capped at 512 MB from the header/stat, the running byte count, and `readStreamWithCap`.

**S3 bodies.** AWS SDK v3 exposes `transformToWebStream`; older node-style bodies are bridged
manually, pausing the source when the web stream's queue fills and destroying it on cancel. The
storage backend is chosen per call from env presence (all four `R2_*` variables set means S3).

**Stitching** keeps a chapter under `stitch_*` in the OS temp dir and removes it in `finally`.
ffmpeg concat lists hold single-quoted relative names; `escapeFfmpegConcatPath` refuses newlines and
backslashes and escapes `'`. The ffmpeg timeout scales with downloaded bytes at 48 kB/s, floored at
5 minutes and capped at 1 hour.

## Front end

**Layering.** `src/hooks/` holds cross-feature app state and never imports a component module — so
`usePlaybackSession` takes `showToast` as an argument instead of calling `useToast`. Screen-local
hooks under `src/components/*/` may consume the toast context directly. Feature-local hooks live
with their feature; `useAudioPlayer` is a thin composition of the two element-level hooks beside it,
which nothing else uses.

**Session restore.** `useAuthSession` starts `preloadLibrary()` and the `/api/auth/me` check in one
effect. `preloadLibrary` returns `null` when no session hint is stored and a promise otherwise; that
promise becomes `bootBooks`, priming the library from a response already paid for instead of
re-fetching. The authenticated shell is keyed by `user.id ?? user.email` so a different identity
remounts it.

**Playback invariants.** `playChapter` guards every state write with a monotonically increasing
request id, so a slow fetch for one chapter cannot overwrite a newer one. The progress save runs
before the playback target is replaced — that ordering persists the *previous* chapter's position
when switching. `resolveStartSegmentIndex` trusts accumulated durations first, then falls back to
the nearest voiced line, then the first playable one, because a resume timestamp can point into a
segment with no audio.

**The audio element is a module singleton** that outlives the player, so every command re-reads it
rather than caching a node. `wantsPlaybackRef` is the only source of intent and is cleared when the
browser blocks a play; `playGenerationRef` invalidates in-flight async `play` calls when a new
source load starts. `canplay`, `canplaythrough`, and `loadeddata` all retry a pending play because
browsers drop `play()` issued while loading, and `stalled`/`suspend` restart playback when intent
survives.

**Source identity** is `` `${segmentId}:${durationMs ?? 0}:${src}` ``. Forced reloads append
`&_=<timestamp>` to defeat the HTTP cache and store the busted URL, so the next render sees a
mismatch and reloads the plain URL — restarting that line from the beginning, which is the intended
outcome after regeneration. A seek into a not-yet-loaded segment is stored as a pending value and
consumed by the next load; a playable trailing segment with no known duration restarts rather than
jumping inside a non-existent timeline.

**Buffering** polls `/api/chapters/:id/segments` every 1200 ms while the next line is missing, with
SSE `segment_ready` patching the list in place (throttled to one refresh per 500 ms). A safety net
retries `play()` every 800 ms up to five consecutive failures before dropping the playing flag.

**Sleep timer lives in `App`**, not the player: the player receives preset and remaining seconds as
props, so a timer survives chapter switches. The deadline is the source of truth and
`sleepTimeLeft` derives from it; resuming re-anchors the deadline to the remaining seconds so a
pause does not consume sleep time. The countdown only runs while playing — a timer set before a
long pause used to tick down and expire mid-pause.

**SSE reconnects** with exponential backoff (1 s base, 30 s cap). A native `EventSource` sends
cookies but does not expose the status, so on error the hook probes `/api/auth/me` first: a 401
ends the stream instead of retrying forever. Events emitted during an outage are lost, so
`onReconnect` triggers a refetch — otherwise SSE-only views would stay stale.
