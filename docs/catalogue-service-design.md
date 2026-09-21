# Offline Book Catalogue Service — Design (v2)

A self-hosted metadata catalogue that replaces flaky live torrent searches with
a queryable offline index of EPUB books, returning torrent magnets that the
existing TorBox pipeline consumes.

Solves two observed failures of the current live-search path:

1. **Coverage** — live indexers (APIbay, torrents-csv, TorBox search) miss many
   books entirely; they only see whatever is currently indexed/seeded.
2. **Non-English** — public indexers are strongly English-biased. The shadow
   library catalogues carry large non-English EPUB collections — exactly the gap
   this app cares about.

The catalogue is **metadata + hashes only** (no book files).

---

## 1. Data source (v3 — validated in Phase 0)

**Do NOT use the full `aa_derived_mirror_metadata` ES dump.** Phase 0 measured it:
it is a **1.5 TB metadata-only torrent**, and the `aarecords` ES index alone is
**~1 TB** (276 gzip-NDJSON files, ~918 GB). That is uneconomical to download
and process for a catalogue that keeps ~2–5% of it.

Instead, source **lean metadata + resolved infohashes**. Verified in Phase 0:

- **Metadata containers (AAC, zstd NDJSON)** are published as separate torrents
  per source, and are far smaller than the unified index:
  - `zlib3_records` (Z-Library — predominantly EPUB): **~24 GB** latest
  - `duxiu_records` (Chinese): **~38 GB**
  - libgen fiction metadata from libgen's own DB dumps (single-digit GB)
- **Infohash resolution** is a **17.7 MB file**: `/dyn/torrents.json`. It lists
  all 22,631 torrents with **100% `btih` coverage** and a `url` whose path joins
  1:1 to the `external/<collection>/<range>.torrent` reference in records.
  Verified join: `external/libgen_rs_non_fic/r_110000.torrent` →
  `btih=6c282c...`. No bencode parsing needed — the magnet is prebuilt.

**md5 → torrent has two verified paths:**
1. **AA-hosted / upload files**: strip the `https://…/dyn/small_file/torrents/`
   prefix from the torrents.json `url` → matches the record's torrent path →
   `btih`. (Confirmed against real records + real JSON.)
2. **Libgen**: the `libgen_rs_hashes` / `libgenrs_fiction_hashes` tables carry a
   direct **`btih` column** per md5 (plus `ipfs_cid`, `edonkey`, `tth`), and the
   fiction content torrents are `f_<range>.torrent` (~1000 books each).

**Fiction content is small** (Phase 0 measurement):
| group | torrents | files | content size |
|---|---|---|---|
| libgen_rs_fic | 3,146 | 3.1M | **5.3 TB** |
| libgen_li_fic | 1,399 | 1.3M | **2.1 TB** |
| libgen_li_fiction_rus | 2 | 0.8k | 2.9 TB |
| *(context)* zlib | 514 | 12M | 92 TB |
| *(context)* duxiu | 1,024 | 7.8M | 294 TB |

So an **audiobook-from-fiction** service can prioritize the ~7 TB of libgen
fiction content — those torrents are ~1 GB each / ~1000 files, making both
TorBox file-selection and quota cheap. The catalogue stores only **metadata +
btih**, not content, so disk stays at ~10–30 GB.

---

## 2. Key architectural decision: separate build from serve

**Do NOT run the import on the 1 GB VPS.** Build the database on any machine
with headroom (the developer's desktop), then ship the finished SQLite file to
the VPS. The VPS only ever runs the read-only API.

- Removes the 1 GB RAM import constraint entirely.
- Removes peak-disk pressure on the 200 GB VPS (the compressed dump never lands
  there).
- The VPS holds only: OS + Bun + the API + `catalogue.db` (~10–30 GB).

The build machine streams the dump **shard by shard, deleting each shard after
processing**, so even the build machine needs modest disk.

**The SQLite file is disposable.** It is a pure derivative of the source dump —
no backups, no replication. Rebuild and re-ship on a refresh cadence.

---

## 3. Storage: SQLite + FTS5

Unchanged from v1, with two refinements:

- **FTS over `title` + `authors` only** — including `description` roughly
  triples the index for marginal search benefit. Description stays a plain
  column for display/ranking.
- **Tokenizer: `trigram`** instead of `unicode61`. Non-English coverage is the
  whole point of this service, and unicode61 cannot tokenize CJK (the Chinese
  collections are enormous). Trigram gives substring matching across all
  scripts at ~2–3× index size — an acceptable trade. (Requires SQLite ≥ 3.34.)

```sql
CREATE TABLE books (
  md5          TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  authors      TEXT,
  language     TEXT,
  filesize     INTEGER,
  year         TEXT,
  publisher    TEXT,
  cover        TEXT,
  description  TEXT,
  infohash     TEXT,              -- resolved at import; NULL = undecodable
  ipfs_cid     TEXT,              -- first CID from ipfs_infos[]; the no-seeder fallback
  torrent_paths TEXT              -- JSON array, all mirror torrents for this file
);

CREATE VIRTUAL TABLE books_fts USING fts5(
  title, authors,
  content='books', content_rowid='rowid',
  tokenize='trigram'
);
```

Import pragmas: `journal_mode=OFF`, `synchronous=OFF`, bulk-load `books` first,
then `INSERT INTO books_fts(books_fts) VALUES('rebuild')`, then `VACUUM`.

---

## 4. REST API (read-only, on the VPS)

Tiny Bun service (`Bun.serve` + `better-sqlite3`), consistent with this repo's
stack. **Bearer-token auth + HTTPS (Caddy)** — it hands out magnets and must not
be an open proxy.

- `GET /search?q=&author=&languages=en,fr&limit=25` → ranked rows
  (md5, title, authors, language, year, publisher, filesize, cover, infohash,
  magnet, all mirror magnets).
- `GET /book/<md5>` → single record + magnets.
- `GET /health` → row counts + import date (ops check).

Ranking in SQL/API: prefer rows with a resolved `infohash`, more mirror
torrents, language match, then filesize.

---

## 5. App integration (the seam already exists)

The app routes acquisition through `BookProvider` / `ProviderRegistry`
(`src/acquisition/`). The catalogue becomes `CatalogueProvider` — the "vetted
adapter" `docs/acquisition-architecture.md` says is missing.

- `name = "catalogue"`
- `search(query)` → `GET /search`, map rows to `BookResult`
  (`id = md5`, `mirrors[]` = one entry per magnet, `format = "epub"`, plus
  cover/language/year/publisher — richer than the torrent provider's bare
  result, so the app's existing ranking and search UI get better for free).
- `getBook(md5)` → `GET /book/<md5>`.
- `acquire(book)` → TorBox download, with **two changes below**.

### 5a. Required fix: file selection by md5 (correctness bug)

`downloadBookFromTorrent` currently picks **the first `.epub`** in the torrent
(`isExactEpub` in `src/torrent/index.ts`). Shadow-library torrents are
**multi-book archives** — `r_110000.torrent` covers ~1000 files named
`<md5>.<ext>`. The current logic would download the wrong book almost every
time.

Fix: add an optional `expectedMd5` (or filename hint) parameter; when present,
select the torrent file whose name contains that md5. The search-based path
keeps the existing heuristic. This is a small, isolated change.

> **Reference solution:** `iziplay/anna-api` (`pkg/anna/epub.go`) solves the same
> problem robustly — it stores the record's `server_path` identifier
> (`g5/zlib1/zlib1/pilimi-zlib-.../7225029`), matches the torrent basename inside
> it against the torrent's file list, and downloads only that file. Port that
> matching approach rather than reinventing it. Fully noted in
> `catalogue/phase0.md`.

### 5b. Multi-source `acquire` — torrent/TorBox first, IPFS fallback

This is the direct answer to the core problem ("obscure / non-English books have
no seeders"). TorBox availability is real but range-dependent (Phase 0: some
libgen ranges are `stalled (no seeds)`), so torrent alone can't serve the long
tail. Verified alternative in Phase 0:

- ✅ **IPFS gateway over HTTPS**: `https://ipfs.io/ipfs/<cid>` served the exact
  byte-correct file (HTTP 200, `content-length` == `filesize_best`) for a real
  record — **no membership, no CAPTCHA, no bittorrent swarm, no TorBox.** This
  routes around the no-seeders problem entirely, because it is content-addressed
  and independent of swarm health.
- ❌ **AA's own download endpoints** (`/ipfs_downloads/...`, `/db/...`) are
  bot-blocked (HTTP 403, DataDome/DDoS-Guard) — not usable programmatically.
- ⚠️ Third-party gateways in the record (`4everland.io`→451, `filebase.io`/
  `orbitor.dev`→timeout) are unreliable — use `ipfs.io` (+ a couple of robust
  mirrors) instead.

So `acquire` tries sources in order until one succeeds:
1. **TorBox by torrent** (magnet + md5-targeted file selection; kit's `cached`
   flag tells us it's servable before we pay).
2. **IPFS gateway** — `https://ipfs.io/ipfs/<cid>` (or mirror gateways),
   streamed with the same size/type/SSRF-safe validation as torrent downloads.
3. (Future) Z-Library / libgen direct links.

The catalogue stores `ipfs_cid` (from `ipfs_infos[]`) per book so `acquire`
never needs to re-resolve it at run time.

### 5c. Fallback chain, not replacement

Register **both** `catalogue` and `torrent` providers. `ProviderRegistry.searchAll`
already merges and ranks across providers — the catalogue covers the long tail
and non-English; live search remains a backstop for brand-new releases the
catalogue hasn't ingested yet.

### 5d. TorBox availability (RESOLVED in Phase 0)

`checkcached` (`format=object`) is a deterministic, batchable "TorBox has it"
signal — store a `cached` flag per book at build time and rank servable books.
Note TorBox can cache a torrent as an **aggregate zip** (one `*.zip`, no
per-book file id); `acquire` must handle both per-file selection and
extract-by-md5-from-zip.

---

## 6. Build/rollout plan

**Phase 0 — verify the joins (a few hours, local)**
1. Download the **17.7 MB `/dyn/torrents.json`**; build the
   `url-path → btih` map. (Verified: all 22,631 torrents have btih; joins to
   record torrent paths work.)
2. Pull the **lean AAC metadata** for the chosen sources (zlib3_records,
   libgen fiction) and spot-check field quality for epub + non-English records
   (`fr`, `de`, `ru`, `zh`).
3. Test one real **libgen fiction range torrent** through TorBox: file selection
   by md5, quota behavior, cache state (needs `TORBOX_API_KEY`).
4. Decide the language allowlist and fiction-only vs. fiction+nonfiction.

**Phase 1 — ETL (local machine)** — `catalogue/import.ts` in this repo
- Stream each lean AAC `.zst` container → parse NDJSON → filter (EPUB by
  extension, filesize ≤ 200 MB, language allowlist, decodable torrent link)
  → resolve infohash from the torrents.json map (or libgen `btih`) → insert.
- Metadata sources are ~24 GB (zlib) + libgen fiction, not the ~1 TB ES index.
- Rebuild FTS, `VACUUM`, output `catalogue.db`.
- Expected kept set: ~few-to-tens of millions of rows → ~10–30 GB SQLite.
  Import: hours, not days.

**Phase 2 — API + deploy** — `catalogue/server.ts`
- Bearer token, the three endpoints, systemd unit, Caddy HTTPS, firewall.
- `rsync catalogue.db` to the VPS; restart.

**Phase 3 — app wiring**
- `CatalogueProvider` + registration + `CATALOGUE_BASE_URL` / `CATALOGUE_TOKEN`
  env vars (empty → provider fails closed, like the anna-archive stub today).
- The `expectedMd5` file-selection fix in `torboxService.ts` + mirror fallback.
- Tests: provider mapping (fixture rows), md5 file-selection against a
  synthetic multi-file torrent list.

**Phase 4 — refresh ops**
- Quarterly (or on new AA releases): rebuild locally, rsync, restart. Old DB
  file kept until the new one is verified, then swapped atomically (rename).

---
<!-- Appendix recorded 2026-08-12 during live VPS deployment -->

## 8. VPS deployment reality (appendix, 2026-08-12)

Live notes from deploying on the 1 GB / 200 GB Oracle box (`book-app`):

- **Disks are split**: 45 GB OS (`/`) + **127 GB data disk at `/mnt/book_data`**
  (117 GB free, chowned to `ubuntu`). Put the DB + metadata there, never on `/`.
- **Build-on-VPS worked, contradicting §2's "don't build on the 1 GB VPS".**
  The lean import streams line-by-line through the `zstd` CLI and inserts in a
  single transaction with `journal_mode=OFF` / `cache_size=-200000`, so peak
  RSS stayed well under 1 GB. `import.ts` is deployable to the VPS directly.
- **Download reality (the seeder question, measured)**: the `zlib3_records`
  metadata torrent advertises ~6–9 seeders but only **2 connect** from this
  box → **~1.2 MiB/s → ~4.5 h ETA** for the 20 GiB file. The `zlib3_files`
  409 MiB file downloads after. It *does* complete (AA re-seeds), just slowly.
  The 45 GB OS disk has no space for the raw dumps — ingest decompressed
  streams and delete shards; keep only the built `catalogue.db`.
- **Torrent plumbing used**: `annas-archive.org/dyn/torrents.json` DNS was
  dead from the VPS (takedown/rotation) → grabbed a **Wayback snapshot**
  (`web.archive.org/web/20251219…/dyn/torrents.json`, 13 MB, 17,879 torrents).
  The `data_folder` from `zlib3_files` joins to `torrents.json` entries by
  `display_name == data_folder + ".torrent"` → btih.
- **Deploy assets** (all in `catalogue/`, E2E-verified on sample AAC dumps):
  - `import.ts` — records+files → `catalogue.db` (schema §3, trigram FTS)
  - `server.ts` — read-only search API (§4 endpoints, Bearer + optional token)
  - `deploy.sh` — installs systemd unit, token generation, health check

---

## 7. Open decisions

1. **Language allowlist** — the whole point is non-English; decide the initial
   set (or keep all languages and filter per-query — DB size is the cost).
2. **Fiction-only vs. +nonfiction** — `content_type` makes this a one-line
   filter choice; affects DB size ~2×.
3. **TorBox availability (RESOLVED in Phase 0)** — `checkcached` (`format=object`)
   is a deterministic "TorBox has it cached" signal and can be **batched** by
   hash. Store a `cached` flag per book at build time and rank downloadable
   books first; TorBox-servable availability is range-dependent (some libgen
   ranges are `stalled (no seeds)`). Also flag torrents TorBox caches as an
   aggregate **zip** (no per-file id) so `acquire()` knows to extract-by-md5
   from the zip vs. selecting a file id.
4. **Cover hotlinking** — `cover_url_best` points at libgen/zlib CDNs; fine to
   hotlink initially, no storage needed.
5. **IPFS mirrors** — records also carry IPFS CIDs and `BookMirror.kind`
   already supports `"ipfs"`. A later resilience fallback if a torrent is dead
   and TorBox can't fetch it.
