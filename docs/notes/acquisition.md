# Acquisition notes

Implementation-level knowledge that the code cannot state on its own. For module boundaries, API
contracts, and database lifecycle see `docs/acquisition-architecture.md`.

## Trusted hosts and redirects

Mirror URLs and redirect targets originate in third-party metadata, so any of them can be attacker
influenced. Every download path therefore allow-lists the host before a byte is fetched, and a
redirect can never widen that allow-list.

- Archive.org accepts `https:` on `archive.org` or any `*.archive.org` subdomain. The CDN serves files
  from `ia801234.us.archive.org`, which is why subdomains are allowed at all. Redirects are followed
  manually, capped at five hops, and each hop is re-validated; the JSON API uses the same rule with a
  three-hop cap.
- Project Gutenberg accepts `https:` on `gutenberg.org` and `www.gutenberg.org`. The fetch itself
  follows redirects, so only the initial destination is validated.
- LibGen download URLs are assembled from the provider's own base URL plus an md5 and a key scraped
  from its download page, so no user-supplied host reaches the request.
- The catalogue sidecar must stay on the host of its configured base URL, and a redirect may not
  downgrade away from the base protocol (`https:` unless the base itself is plain HTTP for local
  development).

A malformed mirror URL and a valid URL on an untrusted host produce different errors on purpose:
`Invalid mirror URL` means the URL could not be parsed, `Invalid Archive.org download destination`
means it parsed but pointed somewhere unexpected.

## Archive.org search and acquisition

- The search filter (`mediatype:(texts) AND format:(EPUB) AND -collection:(inlibrary) AND
  -collection:(printdisabled)`) excludes lending-restricted collections, so every hit can be
  downloaded anonymously. Without it, results resolve to items that only borrowers can open.
- Free-text terms are sanitised to letters, marks, numbers, and whitespace before encoding, because
  Archive.org query syntax treats the remaining punctuation as operators.
- Two strategies run in order: title plus author, then title alone. The fallback exists because
  transliterated author names frequently do not match the item's recorded metadata.
- Item metadata lists several files; the first `.epub` that is not `_lcp.epub` wins. LCP files are
  DRM-encrypted and unreadable by the EPUB parser.

## Project Gutenberg

Gutendex entries without an `application/epub+zip` format are dropped rather than downgraded to
another format, since the pipeline only ingests EPUB. Requests send a browser user agent because
Gutenberg rejects default client agents.

## LibGen HTML

LibGen has no JSON API, so search results are parsed out of its HTML table and the download key is
scraped from the intermediate page. The structure that matters:

- Rows are split on `<tr`; a row is only usable when it carries an `ads.php?md5=<32 hex>` link, has at
  least eight `<td>` cells, and yields a non-empty title after the edition note in `<i>` is removed.
- The format cell is whichever cell's text is exactly one of `epub pdf mobi azw3 djvu fb2`; rows whose
  format is not among the requested formats are dropped. The file size is read from the cell linking
  to `file.php?id=`, and the year from the first `;`-separated part of the year cell.
- Downloads happen in two steps: `ads.php?md5=<id>` yields a `get.php?md5=<id>&key=<key>` link, and
  that link streams the file. A missing key means the book is gone.
- LibGen answers some failures with an HTML error page and HTTP 200 (for example `3306.
  max_user_connections`). A `text/html` content type on the file response is therefore treated as a
  provider failure and the first 160 characters of stripped text are surfaced in the error.

## Fallback acquisition

`fetchEpubFromArchiveOrg`, `fetchEpubFromGutenberg`, and `fetchEpubFromLibgen` are the fallback path
used when torrent acquisition finds nothing. Each searches its provider, ranks the candidates against
the requested title and author, and returns the first result that passes all three gates: larger than
5000 bytes, a real ZIP container, and — for items claiming an Indic language — containing text in
that script.

The script check exists because third-party metadata language claims are frequently wrong for Indic
titles, where OCR or a wrong edition can leave Latin text behind while the metadata still says `hin`
or `mar`. A download is only rejected when the claim is Indic *and* the sampled text has no Indic
script at all. Sample text comes from the first 20 chapters, and an unparseable EPUB passes the check
(fail open) so that a parser quirk cannot silently discard usable books.

Per-candidate failures log and continue; a search failure logs and returns `null`. The caller then
tries the next provider.

## Catalogue sidecar

The catalogue is optional infrastructure. Missing `CATALOGUE_BASE_URL` or `CATALOGUE_TOKEN`, an
unreachable sidecar, a non-200 response, or malformed JSON all yield an empty candidate list rather
than an error, so a broken sidecar degrades torrent search instead of failing a whole ingest.

When the author-filtered query returns nothing, the search retries without the author and re-sorts the
hits by how many significant author words (longer than two characters) appear in the hit's author
field. This recovers books indexed under a pen name or a transliteration the query did not match.

## Provider registry

- Search results are cached in `book_search_cache` keyed by normalised query and provider. The TTL is
  `BOOK_SEARCH_CACHE_TTL_MS`, clamped to 60 seconds … 7 days, default one hour. Out-of-range or
  non-integer values fall back to the default rather than throwing.
- `BOOK_SEARCH_MAX_RESULTS` (1 … 100, default 25) caps both the limit handed to a provider and the
  number of results returned to the caller.
- Provider searches go out with `limit: min(requested limit, max results)` and are ranked before the
  final slice, so ranking sees more candidates than the caller asked for.
- Detail lookups upsert `book_metadata` keyed by `(provider, provider_book_id)` and refresh
  `last_verified`.
- A cache hit is served even when the provider is not currently enabled, because the cache is keyed by
  provider name rather than by the live registry.

## Ranking

- Preferred languages default to `en` and formats to `epub`, both overridable through
  `PREFERRED_LANGUAGES` and `PREFERRED_FORMATS`.
- MARC/ISO-639-2 codes (`hin`, `eng`, `fre`, …) are mapped to ISO-639-1 before comparison, because
  Archive.org and Gutendex report 639-2 while the preference lists are written in 639-1. The mapping
  lives in `languageCodes.ts`.
- Titles and authors are normalised with NFKC and split into whole-word tokens; substring matches score
  nothing. The stopword list keeps common articles from inflating matches.
- Identical ISBNs are deduplicated after sorting, so the highest-scored occurrence survives.
