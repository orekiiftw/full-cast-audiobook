# The torrent module

`src/torrent/` finds EPUB torrents for a book, ranks the candidates, and downloads the
best one either through TorBox or through IPFS. The folder is split by concern, and
`index.ts` is the only thing the rest of the repo imports; it re-exports
`TorrentCandidate`, the safety guards, the search-query builder and the TorBox search
circuit, and implements the three top-level flows (`searchBookTorrent`,
`downloadBookFromCandidates`, `downloadBookFromTorrent`).

## Files

| File              | Responsibility                                                              |
| ----------------- | --------------------------------------------------------------------------- |
| `types.ts`        | `TorrentHit` (one indexer result) and `TorrentCandidate` (a magnet plus state) |
| `client.ts`       | TorBox HTTP transport: API key, capped JSON/error reads, validated redirects, log-text helpers |
| `search.ts`       | Query variants, infohash normalization, the three indexers, the search circuit |
| `ranking.ts`      | EPUB scoring, candidate health ordering, cold-candidate predicate          |
| `candidates.ts`   | Resolve hits into candidates, cache-check and liveness probing              |
| `safety.ts`       | Download-URL and DNS guards, private-address classification, IPFS CID check |
| `download.ts`     | TorBox torrent download flow, EPUB verification, torrent file selection     |
| `ipfs.ts`         | IPFS gateway download flow (and the catalogue VPS node)                     |

## TorBox CDN host allow-list

`assertSafeDownloadUrl` only accepts `torbox.app`, `tb-cdn.pw` and `tb-cdn.io` (and any
subdomain of those three). TorBox's `requestdl` endpoint hands out per-region download
hostnames that are *not* on `api.torbox.app` — the observed form is
`nexus-008.indi.tb-cdn.pw` — so the guard has to match suffixes, not a fixed list.
Substring matching is deliberately avoided: `tb-cdn.pw.evil.com` and
`evil.com/?x=tb-cdn.pw` must both fail, which is why the check compares `hostname` to
the bare domain or `.<domain>`.

## Redirect handling

Every fetch in this module uses `redirect: "manual"` and walks the hops itself, so a
download URL that passes the host allow-list cannot silently bounce to an unguarded
host. Hop budgets differ per transport: 3 for the TorBox API (`MAX_API_REDIRECT_HOPS`),
5 for the TorBox CDN (`MAX_REDIRECT_HOPS`), 3 for IPFS gateways
(`MAX_IPFS_REDIRECT_HOPS`). Each hop is re-validated: the TorBox API accepts any
allow-listed host (V1 endpoints answer on the shared `api.torbox.app` host), while the
CDN and IPFS paths run the URL through `assertSafeDownloadUrlDns` / the gateway host
list again. The IPFS flow has one escape hatch: a redirect that keeps the same hostname
and protocol is tolerated even when it is not `https:`, because the catalogue VPS may
serve plain HTTP behind a reverse proxy.

## DNS cache

`resolveHostCached` in `safety.ts` keeps a process-wide `Map` with a 30 s TTL. A cache
hit re-inserts the entry so the map stays roughly LRU-ordered, and the map is trimmed
from the front when it grows past 100 entries. The cache matters because each CDN
redirect hop re-resolves its host; caching keeps a download from paying for DNS on
every hop, while the short TTL still lets a real DNS change take effect quickly.

## Size and attempt caps

- JSON responses from TorBox are capped at 32 MB (`JSON_RESPONSE_CAP`); error bodies at
  64 KB (`ERROR_TEXT_CAP`), because the API returns its `detail` inside a JSON envelope.
- A downloaded book is capped at `TORRENT.MAX_FILE_SIZE_BYTES` (200 MB) twice: the
  `content-length` header is checked up front and the stream is capped while reading.
- TorBox search gets at most 2 attempts with a 750 ms pause (`MAX_SEARCH_ATTEMPTS`,
  `SEARCH_RETRY_DELAY_MS`). Unreachable, 401/403/404 responses and a `0 per ...` quota
  message trip the process-wide circuit breaker in `search.ts`; a plain 429 or 5xx is
  retried once and then falls through to the fallback indexers.
- Liveness probing is capped at 5 hashes per search (`ALIVE_PROBE_MAX`) because each
  probe is a `torrentinfo` call and the account's request budget is shared. Probes run
  concurrently with `Promise.all`, so the cap also bounds the burst.
- Download polling: 60 polls for a cached torrent and 12 for an uncached one
  (`TORRENT.MAX_POLLS` / `MAX_POLLS_UNCACHED`) at `TORRENT.POLL_INTERVAL_MS` (10 s).

## Indexers and normalization

TorBox search (only the first query variant, since it is the metered one), apibay
(`cat=601`, the ebooks category) and torrents-csv (`size=25`) are queried in that order.
Fallback indexers swallow per-query errors so one bad variant cannot kill the search.
`buildTorrentSearchQueries` produces up to five `... epub` variants — full author, then
surname only, then title only, then keyword-only fallbacks — after NFKC normalization;
the punctuation stripping is what keeps non-Latin titles alive, since a query that
reduces to nothing would otherwise be dropped. `cleanHash` strips `urn:btih:` and any
non-hex characters; `infohashFromMagnet` reads the `xt` parameter and falls back to the
first 40-hex run in the string.

## Ranking

`scoreEpubTorrent` rewards `.epub` filenames (+50) and seeders (`min(seeds, 50)`),
punishes PDF (−20), mobi/azw (−5) and audio formats (−40), adds +8 per title token and
+4 per author token found in the name, and biases toward plausible ebook sizes: +10
below 20 MB, −10 above 50 MB. A hit survives only if its name mentions epub, every
title token matches, and the score is positive. Candidate ordering is
cached > alive > unknown > dead, then seeders, then name.

## Candidates, cold editions and IPFS

A candidate is "cold" when `cached === false && alive === false` (see
`isColdCandidate`). Cold editions are skipped without contacting TorBox *only* when a
healthier candidate is still ahead in the list; when everything is cold the best-ranked
one is attempted anyway as a last resort. IPFS is tried first for cold candidates and as
a fallback whenever a TorBox attempt fails. `downloadBookFromIpfs` prefers a
self-hosted catalogue node (`CATALOGUE_BASE_URL` / `CATALOGUE_TOKEN`) before the public
gateways `ipfs.io`, `dweb.link`, `w3s.link` and `nftstorage.link`, in that order. The
TorBox `createtorrent` call carries `add_only_if_cached=true` for cold candidates, so
TorBox itself refuses to start a download that will not complete.

## File selection and verification

`selectTorrentFile` prefers a file whose name contains the expected md5 (some trackers
name the ebook after its md5 hash), normalizing away non-hex characters so a
`.epub.gz` suffix still matches; otherwise it takes the first exact `.epub`, skipping
`sample` files and `.epub.txt` decoys. Every downloaded buffer is rejected if it starts
with `%PDF` or carries a `.pdf` name, and must pass the ZIP magic test
(`isZipBuffer`) to be accepted as an EPUB.
