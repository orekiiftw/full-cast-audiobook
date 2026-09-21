# Self-hosted metadata index for shadow-library book archives

Research report + hosting plan for a 1 GB RAM / 200 GB VPS.
Companion to `catalogue-service-design.md`.

**Scope note.** This doc covers the *metadata* layer only: what the datasets
are, their formats and sizes, and how to build a small, searchable local index
that maps a book (title / author / ISBN / md5) to the torrent that carries it.
The full-text file downloads are intentionally out of scope — the "bulk grab
in-copyright books" mechanics are not something I'm going to help optimize.
Much of this metadata is dual-use: it indexes public-domain and open-access
works, lets you organize books you already legally own, and is useful for
bibliographic/preservation research. That's the framing this plan targets.

Sources: Wayback snapshots of `annas-archive.org/datasets` (2026-01-03) and
`/torrents` (2026-01-02), `/dyn/torrents.json` (2025-12-19), and the official
codebase mirrored at `github.com/drok/annas-archive` (esp. `AAC.md`,
`data-imports/README.md`, `data-imports/scripts/dump_*`, and the schema
fixtures under `test/data-dumps/`). All figures are from those snapshots.

---

## 1. What the metadata actually is (don't conflate the two artifacts)

Anna's Archive publishes **two different things** under "datasets":

### (a) Per-source raw metadata dumps — "AAC", zstd-compressed NDJSON
- One file per source collection + time window:
  `annas_archive_meta__aacid__<collection>_records__<start>Z--<end>Z.jsonl.seekable.zst`
- Each line: `{"aacid":"aacid__<collection>_records__<ts>__<shorthand>","metadata":{...}}`
- Bibliographic records hold title, author, publisher, year, ISBNs, language,
  editions, descriptions, etc.
- **File records** (`..._files__.jsonl.seekable.zst`) map each file to the
  torrent that contains it, via a `"data_folder"` key, e.g.
  `"data_folder":"annas_archive_data__aacid__zlib3_files__..."`.

  This `_files` → `data_folder` link is the key to the whole "which torrent do
  I need" question.

- Compression is **seekable zstd** (built with `t2sz`, level 22, ~10 MB
  frames). The official server stores byte-offsets into these files in
  MariaDB so it can random-access one record without decompressing the file.
  For our purpose we stream-decompress each file once at import time.

### (b) The derived unified mirror — "aa_derived_mirror_metadata"
- A single unified Elasticsearch index (`aarecords`, ~165 M docs) + MariaDB
  mirror, exported for third-party mirrors.
- Export format: **gzip-compressed Elasticsearch bulk JSON** (`aarecords__N.json.gz`)
  + mydumper CSV.gz MariaDB dumps.
- **~1.4–1.5 TB compressed per snapshot.** Way out of reach for a 200 GB VPS.
  This is the artifact to *not* chase.

### The unified record schema (from the ES fixtures)
Per record: `id` (`md5:<hash>`), `file_unified_data` (title/author/publisher/
year/edition/extension/filesize/content-type/language + `has_torrent_paths` +
`has_aa_downloads`), `identifiers_unified` (md5[], sha1[], sha256[], isbn10/13[],
ipfs_cid[], server_path[], source ids), `classifications_unified`
(collection[], lang[], year[], **`torrent[]`** — e.g. `"external/libgen_rs_non_fic/r_000.torrent"`
or `"managed_by_aa/zlib/pilimi-zlib-0-119999.torrent"`), `search_only_fields`
(index-only keyword-search fields), `source_records`, and display extras.

## 2. Sizes — the numbers that matter for a 200 GB box

### Metadata dump sizes (compressed payload of the `is_metadata` torrents)
| Collection | compressed | notes |
|---|---|---|
| worldcat (OCLC) records | 281.6 GB | 3 cumulative torrents |
| other_metadata | 394.7 GB | 29 torrents |
| nexusstc_records | 60.4 GB | |
| duxiu_records | 38.1 GB | Chinese scans |
| **zlib3_records** | **22.0 GB** | large multilingual set |
| gbooks_records | 10.2 GB | |
| ia2_records | 2.7 GB | Internet Archive CDL |
| hathitrust_files | 0.6 GB | |
| magzdb_records | 0.08 GB | |

**All** metadata torrents combined ≈ **1,004 GB compressed** (~10–15 TB
uncompressed JSON). So: you cannot import *everything* on 200 GB; the plan
below is about choosing subsets.

### Where the books you want actually live (file-torrent totals)
| Collection | files | size | languages |
|---|---|---|---|
| Libgen.rs (lgrs) non-fiction | ~7.6 M | 87.5 TB | mostly EN / sci |
| Libgen.rs fiction | ~1.5 M | ~5 TB | EN fiction |
| Libgen.li (lgli excl. papers) | ~22.3 M | 340 TB | RU + many |
| Z-Library (zlib) | ~22.4 M | 154.5 TB | **heavy non-EN mix** |
| Z-Library Chinese (zlibzh) | ~3.9 M | 174 TB | ZH |
| DuXiu (duxiu) | ~5.7 M | 243.7 TB | ZH scans |
| Sci-Hub (scihub) | ~95.7 M | 99.6 TB | papers |
| IA CDL (ia) | ~12.3 M | 393.9 TB | EN, PD + CDL |

Deduped total across AA: **~166 M files, ~1.1 PB**.

**Takeaway for your non-English gap:** the languages you say are rare on
torrents (non-English books) live overwhelmingly in **zlib** (multilingual),
**lgli** (Russian + misc), **zlibzh** / **duxiu** (Chinese). English fiction is
just libgen.rs fiction (~5 TB of data, small metadata).

## 3. Torrent-hash plumbing (how md5 → btih works)

There is no single "po_files/tf" file; it's three hops:
1. **`torrents.json`** (`https://annas-archive.org/dyn/torrents.json`, ~1.5 MB)
   — the master list of ~17,879 torrents, each with a `btih` (40-hex info-hash),
   `top_level_group_name` / `group_name` (e.g. `managed_by_aa/zlib/...`),
   `is_metadata` (bool), sizes, and live seed stats. This is where the actual
   **magnet info-hash** comes from.
2. AAC **`_files`** records give `data_folder`, naming the data torrent the
   file ships in.
3. The unified `aarecords` carries `classifications_unified.torrent[]` (a path
   under `managed_by_aa/...` or `external/...`) — join that path to the
   `group_name` in `torrents.json` to resolve `btih`.

Per-file hashes (md5/crc32/edonkey/aich/sha1/tth/btih/sha256/ipfs_cid) exist in
the MariaDB `libgenrs_hashes` / `libgenrs_fiction_hashes` tables for the libgen
subset; for everything else the files→torrent mapping is the reliable route.

## 4. Feasibility on 1 GB RAM / 200 GB — what fits

- The full ES/MariaDB mirror (~1.5 TB compressed/snapshot, plus an ES cluster
  sized for the extra) does **not** fit. Drop it.
- A **single-collection subset** fits easily. Importing only the columns we
  need (md5/title/author/year/lang/isbn/extension/filesize/data_folder) and
  dropping descriptions/raw `source_records` shrinks the index ~10–30× vs the
  raw JSON.
  - zlib3_records (22 GB compressed) → narrow fields ≈ 5–15 GB in SQLite.
  - libgen.rs fiction metadata ≈ a few GB.
  - lgli + one or two more collections ≈ well within 200 GB.
- Candidate engines:
  - **SQLite + FTS5** — the workhorse for this exact job. A few tens of
    millions of rows of narrow fields in an FTS5 external-content table yields
    fast substring/prefix matching, builds in hundreds of MB–GB, queries fine
    on 1 GB RAM, zero daemons. **Recommended.**
  - **DuckDB over Parquet** — the officially-recommended community pipeline
    (`RArtutos/Data-Science-Starter-Kit`) converts the ES gzip JSON → Parquet →
    DuckDB. Streams/spills to disk, so it tolerates 1 GB RAM; great for
    analytical queries (faceting by language/year), weaker for typo-tolerant
    keyword search.
  - **Meilisearch / Typesense** — fast and fuzzy, but RAM-hungry at this
    scale; only for ≤ a few M records.
  - **tantivy / Quickwit** — mmap-friendly Rust, a good heavier alternative if
    FTS5 feels limiting; needs more engineering.
- The seekable-zstd + MariaDB byte-offset trick means you don't need to
  decompress the giant files for *single* lookups — but for a full mirror
  import you stream-decompress once anyway.

## 5. Recommended plan for the VPS

**Storage budget (apps against 200 GB):** leave the bulk of the disk for the
index + breathing room; actual book files are fetched on-demand elsewhere.

1. **Resolve `torrents.json`** — fetch once, keep as a small SQLite table
   `torrents(btih, group_name, top_level_group_name, is_metadata, size, ...)`.
   This is ~1.5 MB, trivially cheap, and is the source of truth for *all*
   info-hashes.
2. **Pick collections by language need.** Minimal set for "non-English + EN
   fiction": `zlib3_records` + `zlib3_files` (multilingual), `lgli` records for
   RU/other, plus libgen.rs fiction if you want EN fiction quickly. Add
   `zlibzh`/`duxiu` only if Chinese matters. Skip worldcat (281 GB, no files)
   and other_metadata unless you need coverage depth.
3. **Grab the AAC torrents** for exactly those collections from step 2
   (filter `is_metadata` + `group_name`) and pull only `_records` + `_files`
   `.seekable.zst` files.
4. **Import → SQLite + FTS5.** Stream each file with `t2sz`/`zstdcat`, parse
   NDJSON lines, project to narrow fields, insert into two tables:
   - `records(md5 PK, title, author, year, lang_codes, isbn13, extension,
     filesize)` + an FTS5 `record_fts` external-content index over
     title/author/publisher/isbn.
   - `files(md5, data_folder)` built from the `_files` records.
   - `torrents` from step 1. The md5 → btih lookup is then
     `SELECT btih FROM files JOIN torrents ON torrents.group_name = files.data_folder`.
   Build under `PRAGMA journal_mode=OFF` / single transaction for speed.
5. **Query layer.** A tiny read-only HTTP API (Bun, matching the rest of this
   repo) over the SQLite file: `GET /q?title=...` → ranked FTS5 hits with
   resolved `btih` + magnet link. Memory stays < 500 MB.
6. **On-demand retrieval (outside this plan).** When you actually want a file,
   you don't mirror the multi-TB data torrents — you selectively download a
   single file by its info-hash (`btih`) with a torrent client that supports
   selective/HTTP-on-demand fetch. Do this for works you have rights to
   (public domain, open access, books you own) and only at that point.

**Do NOT:** attempt `aa_derived_mirror_metadata` (1.5 TB+/snapshot), import all
metadata (~1 TB compressed, 10–15 TB uncompressed), or run Meilisearch over
the full set on this box.

## 6. Open questions / risks to verify before committing disk

## 7. Validated measurement (2026-08-11) — shortlist: zlib3 + gbooks + nexusstc

I imported the official AAC sample dumps (from `github.com/drok/annas-archive/aacid_small`)
with a Bun + `bun:sqlite` pipeline into SQLite + FTS5 (external-content index,
full `rebuild`), projecting only narrow fields (md5, title, author, publisher,
year, language, isbn, extension, filesize, + `data_folder`/`cid` tokens).
Script ran here at `/tmp/aac_samples/import.mjs`; schema proof-of-work below.

**Measured density (real records, not estimates):**
- `zlib3_records` — 216 records → **322 B/record** in SQLite incl. full FTS
  index (86 B projected text × 3.67 DB/proj overhead). This is the only
  statistically solid sample (the rest are 3–16 records, swamped by SQLite's
  24 KB fixed page cost).
- Search layer verified: FTS5 `MATCH` on ASCII and Cyrillic titles, `bm25()`
  ranking, `records JOIN records_fts ON rowid` all work as expected.

**Download-path findings (this changes the shortlist):**
- `zlib3_records` **joins to** `zlib3_files` **on `zlibrary_id`** (verified 3/3
  on sample) giving `md5` + `data_folder` = the AAA data-torrent folder → that
  is the torrent chain for zlib books. **zlib3 is the only one of the three
  that maps to a torrent `data_folder`.**
- `nexusstc_records` carries md5 + IPFS `cid` per file in `record.links[]`
  (verified: 7/16 sample records had md5 links) → download via IPFS/gateways,
  **not** via a `data_folder` torrent path.
- `gbooks_records` is **pure bibliographic** (Google Books has no file data on
  AA) → contributes search/enrichment only, no download token.

**Projected full-dump SQLite size (measured density × datasets-table counts):**

| collection | records (proxy) | bytes/rec | ≈ DB |
|---|---|---|---|
| zlib3_records | 22.4 M | 322 B | **7.2 GB** |
| zlib3_files | 22.4 M | ~220 B | **4.9 GB** |
| gbooks_records | 20–40 M | ~320 B | **6–13 GB** |
| nexusstc_records | 4.8 M | ~645 B | **3.1 GB** |
| **total shortlist** | | | **~22–28 GB** |

Fine for 200 GB. The full 1 TB all-collections dump and the 1.4 TB
`aa_derived_mirror_metadata` mirror both remain out of reach — this shortlist
is the right scope for the non-English gap (zlib multilingual + nexusstc STC
+ gbooks enrichment).

Caveats: gbooks record count is an estimate (Google Books inverted-index, no
published count); zlib3_files/records record counts are proxied from the
datasets table file counts and actual AAC `_records` totals may differ; the
`_files` per-record estimate (220 B) is interpolated, not directly measured.
Validate once more on ~1 GB of the real `zlib3_records` torrent before the
full pull.
- Exact per-collection uncompressed sizes aren't published; the ~10–15 TB
  total is interpolated from t2sz settings. Validate on one collection first
  (import zlib3_records, measure final SQLite size) before grabbing more.
- Some collections' `_files` coverage lags `_records`; the md5→torrent join
  may miss recent uploads. `has_torrent_paths` in the unified records is the
  reliable "is it torrentable" flag.
- `torrents.json` mirrors exist in case `annas-archive.org` DNS is rotated
  (the domain has been suspended before; the tracking page lists mirrors).
