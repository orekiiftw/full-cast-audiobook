# "Book not found" root-cause research

Findings against primary sources (official docs, first-party endpoints, API specs), verified 2026-08-25.

## 1. Unicode / non-ASCII query support in the public indexers

**apibay** (`apibay.org/q.php`) — No first-party documentation exists; apibay is an unofficial TPB API with no spec page. Empirically (live tests): ASCII `war and peace` returns correct matches; Cyrillic `Преступление` returns `"No results returned"`; Chinese `战争与和平` returns a *non-matching* list of popular English uploads (an apparent fallback, not a query match). Conclusion: apibay does **not** reliably match non-Latin/UTF-8 text — it either returns empty or a default popular listing. This is a likely "book not found" cause for non-English titles.

**torrents-csv** (`torrents-csv.com/service/search`) — No formal ASCII restriction is documented anywhere. Live test: Cyrillic `Преступление` returned a *matching* Russian-titled torrent, so UTF-8 non-ASCII **is** accepted and matched. Chinese `战争与和平` returned `{"torrents":[],"next":null}` (empty, but a valid response — most plausibly no indexed Chinese-language content, not an encoding rejection). Source: the endpoint itself and the site `https://torrents-csv.com/`; no first-party API-manual page state Unicode support explicitly.

**TorBox search** (`search-api.torbox.app`) — This exact URL is **dead**: it no longer resolves (NXDOMAIN as tested), while `torbox.app` and `api.torbox.app` still resolve. TorBox's changelog documents removing `search`, e.g. v4.9 "Removes `/torrents/search` from the main API … consolidate all searching to a single API," and the Torznab/Newznab search routes now require a **paid** account + API key. I could not verify Unicode behavior because the free search endpoint is gone (see §Recommended fixes). Sources: <https://api-docs.torbox.app/>, <https://feedback.torbox.app/changelog/v49>, <https://feedback.torbox.app/en/changelog/v74>, <https://api.torbox.app/openapi.json> (no `/torrents/search` route is present).

## 2. Internet Archive `advancedsearch` `format` parameter

Yes — `format:(EPUB)` / `format:epub` is a working field filter. Test query returned ~6.6M items and normalized `format:(EPUB)` → `format:EPUB`; lowercase `format:epub` returns effectively the same count (case-insensitive). The `format` field holds per-file format labels, e.g. `EPUB`, `Text PDF`, `JPEG`, `DjVuTXT`, `hOCR`, `ACS Encrypted EPUB`, `LCP Encrypted EPUB`, `Dublin Core`, `MARC` (observed in returned `fl=format` values). It is not a closed enumerated facet like `mediatype`; it is the item's file-type list.

`mediatype` **is** a documented enumerated facet. Accepted values (from the metadata schema): `texts, etree, audio, movies, software, image, data, web, collection, account`. `texts` = "books, articles, newspapers, magazines … PDFs, EPUBs, etc." So `mediatype:(texts) AND format:(EPUB)` is a reliable, documented EPUB filter.

Sources: <https://archive.org/developers/metadata-schema/>, <https://internetarchive.readthedocs.io/en/stable/metadata.html>, <https://help.archive.org/help/how-to-search-the-internet-archive/> (documents `format:` usage), <https://archive.org/advancedsearch.php>.

## 3. Anna's Archive metadata dumps

`https://annas-archive.org/dyn/torrents.json` — `annas-archive.org` and `.se` do **not resolve from this environment** (DNS). Mirrors `.gd`, `.li`, `.net`, `.gl` are listed on the datasets page; `.gd` served `/datasets` (200) and `/dyn/torrents.json` (200, ~17 MB), while `.li` returned 404 for `torrents.json`. So reachability depends on the mirror and on this sandbox's DNS resolution; `.org` is not usable here.

`torrents.json` is **not bibliographic metadata** — it is the site's btih→torrent map. Confirmed sample fields per torrent: `url`, `group_name`, `display_name`, `btih`, `magnet_link`, `torrent_size`, `num_files`, `data_size`, `seeders`, `leechers`, `aa_currently_seeding`, `obsolete`, `embargo`, `stats_scraped_at`. You get an infohash per *torrent file*, but no title/author/ISBN/ipfs_cid per book.

For bibliographic metadata **+ infohash + ipfs_cid**, the unified **`aa_derived_mirror_metadata`** dump (ElasticSearch + MariaDB, 28.9 TB, updated 2026-02-08) is the documented single source; the per-source **AAC** dumps (`annas_archive_meta__aacid__*__*.jsonl.zst`) only carry that source's own fields (e.g. Z-Library `title`, `author`, `md5`, `extension`) and do **not** contain Anna-assigned `ipfs_cid`. The datasets page explicitly points to `aa_derived_mirror_metadata` for the combined dB, and the community `aa_local_db` project confirms `ipfs_cid` is stored there.

Sources: <https://annas-archive.org/datasets>, <https://annas-archive.org/torrents#aa_derived_mirror_metadata> (mirror: annas-archive.gl/torrents), <https://annas-archive.gl/blog/annas-archive-containers.html>, <https://github.com/max-mal/aa_local_db>.

## 4. IPFS public gateway availability

All four gateways still respond to `GET https://<gw>/ipfs/<cid>`: `ipfs.io` → 200 (serves directly); `dweb.link` → 301 → 200 (subdomain form); `w3s.link` → 301 → 200; `nftstorage.link` → 302 → 200 (redirects to `ipfs.io`). So they are functioning for raw CID retrieval. The gateway spec documents the `/ipfs/<cid>` and subdomain schemes. Current rate limits: I could **not** obtain exact current per-gateway rate-limit numbers from a primary source this session — treat capacity as best-effort and add fallbacks/retries. Sources: <https://docs.ipfs.tech/reference/http/gateway/>, <https://specs.ipfs.tech/http-gateways/>.

## 5. Simpler / better direct sources

- **Project Gutenberg (Gutendex)** — de-facto standard API; `GET gutendex.com/books?search=…` returns `formats` with a direct `application/epub+zip` URL. Direct EPUB ✅. Catalog is public-domain (~75k), largely English. <https://gutendex.com/>
- **Standard Ebooks** — OPDS feed `https://standardebooks.org/feeds/opds` (OPDS 2 JSON via `Accept: application/opds+json`) with direct EPUB links. Direct EPUB ✅. Small curated catalog (~2,000). <https://standardebooks.org/feeds>
- **Open Library `/search.json`** — rich metadata + `ebook_access`/`availability` (via `fields=*,availability`, which resolves archive.org lending), but **no direct EPUB link** in the search payload — you must resolve the IA item/edition. Metadata-only (plus lending). Note a Jan 2025 breaking change reduced default fields (set `fields` explicitly). <https://openlibrary.org/dev/docs/api/search>, <https://blog.openlibrary.org/2025/01/16/api-search-json-performance-tuning/>
- **Google Books API** — `GET https://www.googleapis.com/books/v1/volumes?q=…&download=epub`; `accessInfo.epub.downloadLink` exists but is populated mainly for public-domain/purchased volumes (`accessViewStatus: FULL_PUBLIC_DOMAIN`/`FULL_PURCHASED`), with country/device restrictions. Partial direct EPUB; strong metadata. <https://developers.google.com/books/docs/v1/reference/volumes>, <https://developers.google.com/books/docs/v1/reference/volumes/list>

## Recommended fixes

1. **Drop / replace TorBox search.** `search-api.torbox.app` is gone and public search is now paid/gated. Remove it as a free indexer.
2. **Guard apibay for non-Latin queries.** Don't send unnormalized UTF-8 to apibay (it silently returns non-matching popular results); strip/transliterate or skip it for non-ASCII titles, and detect its "No results / fallback" output.
3. **Keep torrents-csv for UTF-8** (it handles Cyrillic), but expect empty results for languages with little indexed coverage (e.g. Chinese).
4. **IA query is fine** — keep `mediatype:(texts) AND format:(EPUB)`; both are documented.
5. **Catalogue plan:** use `aa_derived_mirror_metadata` (not `torrents.json`) if you need title/author/infohash/ipfs_cid; `torrents.json` only maps infohash→torrent, no bibliographic fields. Resolve Anna's Archive through a working mirror (`.gd`/`.gl`) since `.org` is DNS-blocked in this environment.
6. **IPFS:** keep `ipfs.io` as primary plus `dweb.link`/`w3s.link` fallbacks; assume best-effort availability.
7. **Prefer legit direct-EPUB sources first** (Gutenberg/Gutendex, Standard Ebooks OPDS) for public-domain titles, and Open Library/Google Books for metadata + targeted EPUB links before falling back to shadow libraries.
