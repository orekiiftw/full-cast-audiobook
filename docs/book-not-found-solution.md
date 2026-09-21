# Fixing "Book Not Found" — Diagnosis & Solution

Companion to `catalogue-service-design.md`, `shadow-library-metadata-index.md`, and
`cold-torrent-acquisition.md`. This documents the **root causes** of "book not found"
and the fixes applied (and still recommended) to close them.

---

## TL;DR

The single highest-impact, lowest-risk "book not found" bug is **Unicode destruction**:
three separate code paths normalized non-Latin titles/authors to an empty string, so a
Chinese / Cyrillic / Devanagari / … book was mathematically un-findable *before any
indexer or the catalogue was even consulted*. This is exactly the "non-English gap" the
catalogue docs say the app cares most about.

Measured (Bun probe against the actual functions, before the fix):

```
title="战争与和平"     -> buildTorrentSearchQueries() == []          // throws, never reaches catalogue
title="Преступление и наказание" -> []                               // throws, never reaches catalogue
title="गोदान"         -> []                                          // throws, never reaches catalogue
rankBooks( [French book, 三体], q="三体" )  -> [ "Vingt mille lieues…", "三体" ]  // WRONG result first
```

After the fix all of these resolve correctly, and the ingestion fallback can reach the
offline catalogue for non-English books.

---

## The acquisition path (what "book not found" actually means here)

```text
POST /api/books { title, author }            # "Add by title + author"
  -> queueBookIngestion
    -> runIngestionJob
      1. resolveTorrentCandidates(title, author)   # live: TorBox search, apibay, torrents-csv
      2. if empty -> searchCatalogueTorrentCandidates(title, author)  # offline catalogue (deployed)
      3. if empty -> fetchEpubFromArchiveOrg(title, author)           # Internet Archive fallback
      4. if still empty -> book.status = "failed"  ("Could not download this book…")
```

"Book not found" is the user-visible end state of every box in that chain coming up empty.
The four distinct root causes, in impact order:

## Root cause 1 — Non-Latin titles are destroyed (CRITICAL — fixed)

Three sites silently stripped every non-ASCII character:

| file | code (before) | effect |
|---|---|---|
| `src/torrent/index.ts` `buildTorrentSearchQueries()` / `tokenize()` | `.replace(/[^a-zA-Z0-9\s]/g, " ")` | `战争与和平` → `""` → `queries == []` → `resolveTorrentCandidates` **throws** "A book title is required" *before* the catalogue fallback in step 2 is ever reached. |
| `src/acquisition/providers/index.ts` `ArchiveOrgProvider.search()` | `term.replace(/[^\w\s]/g, " ")` (JS `\w` without `u` is ASCII-only) | Archive.org fallback (step 3) searches for spaces — a guaranteed empty hit for non-Latin titles. |
| `src/acquisition/ranking.ts` `normalized()` | `.replace(/[^a-z0-9]+/g, " ")` | Title/author token scores for non-Latin results collapse to `""`, so an unrelated Latin book **outranks the exact non-Latin match**, and can push the correct result out of the `slice(0, limit)` window entirely. |

**Fix applied:** every site now uses the Unicode-aware class `[^\p{L}\p{M}\p{N}\s]`
(letters, **combining marks** — required for Indic vowel signs — and digits of every
script), plus `NFKC` normalization. `tokenize()` additionally admits non-ASCII tokens of
any length (dense CJK has 1–2 character words) while keeping the existing Latin stopword /
`>2`-char filter. See `ranking.test.ts` and `torboxService.test.ts` for the regression tests.

This fix alone unblocks step 2 for non-English books: the title now reaches the online
indexers *and* survives to the catalogue fallback.

## Root cause 2 — A live-search throw aborted the fallback chain (fixed)

`resolveTorrentCandidates` throws when it builds an empty query list. Because ingestion
called it unguarded, that exception jumped straight to the outer `catch`, marked the book
`failed`, and skipped the catalogue + Archive.org fallbacks entirely.

**Fix applied:** `src/orchestrator/ingestion.ts` wraps the call in `try/catch`, logs, and
continues to step 2 on any throw. Live indexers are now a *best-effort first look*, never
a gate that a transient failure can slam shut.

## Root cause 3 — The long tail has no live indexer coverage (addressed by the catalogue)

Live indexers (TorBox search / apibay / torrents-csv) only see currently-indexed and
seeded torrents. Middle-popularity and non-English EPUBs are absent there. This is the
problem the three catalogue docs solve in depth: a self-hosted offline index
(`catalogue/`, deployed per `.env` `CATALOGUE_BASE_URL`/`CATALOGUE_TOKEN`) with resolved
infohashes + IPFS CIDs, fetched by `src/acquisition/catalogue.ts` and served via TorBox-cached
→ IPFS-gateway fallback (`downloadBookFromIpfs`). That path is already wired end-to-end in
`src/torrent/index.ts` and `src/orchestrator/ingestion.ts`; its only blocker for non-English
input was Root cause 1.

## Root cause 4 — Offline catalogue not exposed to the interactive search UI (recommended)

The catalogue is consulted during ingestion's title+author fallback, but it is **not**
registered as a `BookProvider`, so `POST /api/book-search` (the Library search box) only
surfaces `torrent` + `archive-org` results. A user searching "Lord of the Mysteries" in the
UI sees zero hits even though the catalogue has it with a resolved infohash.

**Recommended (matches `catalogue-service-design.md` §5):** implement `CatalogueProvider`
as a `BookProvider` (`name = "catalogue"`) over the catalogue's `/search` + `/book/<md5>`
endpoints, register it in `src/acquisition/index.ts` alongside the existing providers, and
let `BookResult` mirrors carry the IPFS CID/torrent so `acquire()` reuses the same
TorBox-cached → IPFS chain. Environment-gated so it fails closed when unset (like today's
`AnnaArchiveProvider`).

---

## What changed (this change set)

- `src/torrent/index.ts` — Unicode-aware query building + tokenization.
- `src/acquisition/providers/index.ts` — Unicode-aware Archive.org search term.
- `src/acquisition/ranking.ts` — Unicode-aware normalization (title/author/cache keys).
- `src/orchestrator/ingestion.ts` — resilient live-search fallthrough to catalogue/archive.
- `src/torrent/torbox.test.ts`, `src/acquisition/ranking.test.ts` — non-Latin regression tests.

## Verification

- `bun run typecheck` — clean.
- `bun test` — 65 pass / 0 fail across 8 files.
- Probe: `buildTorrentSearchQueries("战争与和平","托尔斯泰")` now returns
  `["战争与和平 托尔斯泰 epub", "战争与和平 epub"]` (was `[]`); `rankBooks(…, q="三体")`
  now ranks `三体` first.

---

## Primary-source research findings (see `book-not-found-research.md`)

A parallel investigation against live endpoints/docs adds four refinements that shape the
remaining work. (Full citations are in the research doc.)

### F1 — TorBox's free search endpoint is dead (definite next fix)

`search-api.torbox.app` no longer resolves (NXDOMAIN), while `api.torbox.app` and
`torbox.app` still do. TorBox removed `/torrents/search` from the main API and now gates
search behind a paid account (changelog v4.9 / v7.4). So the **first** hop of
`resolveTorrentCandidates` (`searchTorBox`) is hitting a dead host on every search today.

> Impact is bounded — the DNS miss fails fast and apibay/torrents-csv fallbacks run — so it
> is a cleanup/correctness item, not the primary "not found" cause, but it should be
> removed on the next change so every search doesn't log a misleading `torbox` failure.

### F2 — apibay does not match non-Latin; torrents-csv does (safety check on the Unicode fix)

Live tests: apibay returns `"No results"` for Cyrillic and a **non-matching** popular-English
list for Chinese (a fallback, not a match); torrents-csv correctly returns a matching Russian
torrent and empty for Chinese (coverage gap, not an encoding rejection).

The Unicode fix is safe against apibay's junk: `topEpubTorrents` → `scoreEpubTorrent` requires
**every** title token to appear in the torrent name, so a `战争与和平` query filters out
transliterated/unrelated English hits. Keep `torrents-csv` as the UTF-8-capable indexer, and let
the offline catalogue (which uses trigram FTS over all scripts) carry the scripts the live
indexers lack.

### F3 — Catalogue `ipfs_cid` must come from `aa_derived_mirror_metadata`, not per-source AAC

`annas-archive.org`/`.se` don't resolve here (use `.gd`/`.gl` mirrors). `dyn/torrents.json` is
a btih→torrent map **only** (no bibliographic fields, no `ipfs_cid`). The title/author/infohash/
**`ipfs_cid`** combination lives in the unified `aa_derived_mirror_metadata` dump — the per-source
AAC dumps the design doc §5 assumed CIDs from **do not contain `ipfs_cid`**. This corrects
`catalogue-service-design.md` §5/§5c: the IPFS fallback needs its CID column populated from the
unified dump (or libgen `ipfs_cid`, or `nexusstc` `record.links[]`), not zlib3 AAC alone.

### F4 — IPFS gateways live; add legit direct-EPUB sources first

All four gateways (`ipfs.io`, `dweb.link`, `w3s.link`, `nftstorage.link`) still return 200 for
`/ipfs/<cid>` (some via redirect). For public-domain/classic coverage, prefer first-party
direct-EPUB sources before shadow libraries: **Gutendex** (Project Gutenberg, `formats` has a
direct `application/epub+zip` URL) and **Standard Ebooks OPDS** give direct EPUBs; Open Library
`/search.json` and Google Books are metadata (+ restricted EPUB) only.

---

## Prioritized next steps

1. ~~**Drop the dead TorBox search hop**~~ **Done.** `searchTorBox` is behind a circuit breaker:
   a definitive failure (DNS/connect, 401/403/404, zero quota) disables the provider for the
   process after one call, and the endpoint is overridable via `TORBOX_SEARCH_URL`.
2. **Expose the catalogue as a `CatalogueProvider`** so `POST /api/book-search` surfaces offline
   long-tail results in the Library UI (Root cause 4 / design §5) — environment-gated, fail-closed.
   *Not done: the catalogue service itself is not running (its `CATALOGUE_BASE_URL` refuses
   connections and no `catalogue/` code exists on this machine), so there is nothing to expose yet.*
3. ~~**Add `Gutendex`~~ **Done** (as `GutenbergProvider`); `Standard Ebooks` still open.**
4. **Correct the catalogue ETL** to populate `ipfs_cid` from `aa_derived_mirror_metadata` /
   libgen / nexusstc (F3) so the IPFS fallback actually has CIDs to fetch.

---

## Non-torrent acquisition: what shipped

The pain point is books **no torrent has** (obscure, regional, non-English) and books whose swarms
are **cold** (found but unseedable). Torrent search cannot close that gap, so ingestion now falls
through to direct-download sources, in coverage order:

```text
1. torrents        TorBox → apibay → torrents-csv        (cached / seeded only)
2. catalogue       offline index (when configured + running)
3. archive-org     Internet Archive, lending items EXCLUDED
4. gutenberg       Project Gutenberg via Gutendex
5. libgen          LibGen — the in-copyright long tail
```

Each is gated by `BOOK_PROVIDERS_ENABLED` (default now
`torrent,archive-org,gutenberg,libgen`; the previous default omitted the last two).

### The Archive.org fix that matters most

The old query returned lending-restricted items first, and anonymous downloads of those answer
**401** — which is exactly the failure visible in the server log for the "The Time Machine" run.
The query now excludes the `inlibrary` and `printdisabled` collections and retries title-only when
title+author finds nothing. Measured on "godan": **4/4 results downloadable** with the filter,
versus repeated 401s without it. This is what unlocks the multilingual corpus (Godan in Marathi and
Gujarati, Война и мир in Russian all fetched successfully).

### Measured results (live, this machine)

| Source | Query | Result |
|---|---|---|
| archive-org | Godan (Hindi/Marathi) | ✅ 0.56 MB valid EPUB |
| archive-org | Godan Uttrardh (Marathi) | ✅ 0.51 MB valid EPUB |
| archive-org | Война и мир (Russian) | ✅ 0.60 MB valid EPUB |
| libgen | Godan / Premchand | ✅ 0.56 MB valid EPUB (9s) |
| libgen | The Way of Kings | ✅ 1.79 MB valid EPUB |
| gutenberg | Pride and Prejudice | ✅ 23.69 MB valid EPUB |

### Known limits

- **LibGen is load-shedding.** `get.php` intermittently answers HTTP 200 with an HTML error page
  (`3306. User 'libgen_get' has exceeded the 'max_user_connections'`). The provider detects that
  and throws rather than writing an HTML file as an EPUB; the chain then tries the next result.
- **Anna's Archive cannot be scraped.** `.gd`/`.gl` answer 200 at the root but every search path
  is behind DDoS-Guard (403). The dumps-based catalogue remains the viable route (F3).
- **Gutenberg needs the trailing slash** (`/books/?search=`) — `/books?search=` 301s, and the API
  is slow (observed 0.6–45s), so the client timeout is 45s.

