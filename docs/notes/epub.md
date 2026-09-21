# EPUB parsing

`src/epub` turns an EPUB buffer into `ParsedBook` (title, author, chapters of typed
blocks). `index.ts` is the public surface: `parseEpub` reads as the pipeline itself —
open archive, resolve the package document, read metadata, resolve the reading order,
read spine pages, aggregate chapters. Everything below is the knowledge behind the
stages, most of it learned from real books in the wild rather than from the spec.

## Stage layout

| Module | Concern |
| --- | --- |
| `archive.ts` | ZIP access: decompression-bomb guard, unpacking, entry lookup, capped reads |
| `opf.ts` | container.xml → OPF path, package document, DC metadata, manifest, spine order |
| `blocks.ts` | page DOM → body, heading detection, `BookBlock` extraction and classification |
| `filters.ts` | front/back-matter and TOC heuristics: the rules that decide whether a page is story |
| `spine.ts` | the walk over the reading order into accepted page documents |
| `chapters.ts` | page aggregation into chapters, chapter-start gate, the public book model |
| `text.ts` | string cleanup: whitespace, citation markers, smart quotes, word counts, dialogue, sentence ends |

## Safety limits

The decompression-bomb guard runs **before** `unzipSync`, because decompressing
materializes the whole archive at once. It sums the declared uncompressed sizes from the
ZIP central directory (never trusting the data itself) and rejects the archive as soon as
the running total passes the cap; a single entry larger than the per-entry cap is
rejected on its own. Any ZIP64 locator, ZIP64 sentinel count, or ZIP64 offset is
rejected outright — a 64-bit size field could otherwise slip past the 32-bit arithmetic.

`archive.test.ts` forges each of these shapes so the guard is pinned against attacks, not
just against well-formed input:

- `total entries` forged to 1 while `entries on this disk` stays truthful — fflate reads
  the *disk* field, so a guard that only read the total would under-count and wave the
  archive through.
- A corrupted central-directory signature, which a naive guard skips silently.
- A ZIP64 locator signature patched in right before the end-of-central-directory record.

On top of that guard, `parseEpub` keeps volume caps: total decompressed bytes, container,
package document, per-spine-file, total text, chapter count, and word count. Errors from
these limits say what was exceeded, because a rejected book surfaces to the user.

OPF paths and manifest hrefs come from inside the archive, so both are treated as
attacker-controlled: paths are normalized and rejected if they contain `..`, are
absolute, or would resolve outside the archive. Manifest hrefs are percent-decoded
tolerantly (malformed escapes fall back to the raw href), stripped of `#fragment` and
`?query` the zip entry can never carry, and backslashes are folded to `/` before the
posix join.

Two file-format quirks are load-bearing:

- fflate normalizes entry names without a leading `./`, but EPUBs ship either form, so
  lookups fall back to the stripped path. The same reason the archive does not trust the
  `mimetype` entry: it is not required to find anything.
- Container attribute order and quoting vary across EPUBs, so the rootfile path is found
  by matching the tag first and then looking for `full-path` inside it.
- `linear="no"` marks out-of-sequence content (cover plates, adverts); voicing it inline
  would read out of order, so those spine items are dropped.

## Metadata extraction

Dublin Core fields appear in at least three shapes, and a parser miss silently discards a
book's identity, so `opf.ts` tries every shape before giving up:

1. a DC element under any namespace prefix (`dc:title`, `dcterms:title`, plain `<title>`),
2. EPUB2/EPUB3 `<meta name="title" content="...">` or `<meta property="creator">…</meta>`
   (creator also matches `author`),
3. the parsed DOM, for casing the regexes missed.

Values are stripped of nested markup and entities, and the literal value `unknown` is
treated as absent. When nothing is found, `parseEpub` returns the sentinels
`Unknown Title` / `Unknown Author` — OCR-derived Internet Archive scans look exactly like
this, and `orchestrator/ingestion.ts` treats the sentinels as "absent" rather than
overwriting a real title.

## Page acceptance

The heuristics in `filters.ts` decide whether a book is accepted at all, so their
thresholds are named constants and their order in `spine.ts` is the order below.

**Filename filtering.** Front/back matter is matched on the filename stem, as exact tokens
(`copyright`, `toc`, `nav`, `cover`, `endnotes`, `ack`, …) plus a prefix regex for longer
names (`acknowledg`, `dedicat`, `frontmatter`, `bibliograph`, …). Matching is token-exact
rather than unanchored substring on purpose: a loose regex would silently drop real
chapters like `jack.xhtml` or `descent.xhtml`.

**Front matter by heading.** A page whose heading matches the front-matter title list
(synopsis, contents, praise, about the author, also by, …) is skipped, as is a body
marked `epub:type="toc"`. A page whose heading is a synopsis-like title is never chapter
material.

**Structural TOC pages.** EPUB3 TOC pages are `<nav>`/`<ol>` link lists. A nav with at
least four links, three of them chapterish, is a TOC; so is any nav with eight or more
links. Without a nav, a list of at least five items where four look like chapter entries
and at least half the items do qualifies, but only when the page carries under 80 words
of prose — otherwise it is a chapter that happens to contain a list. Skipping matters
beyond book structure: these pages are read aloud, so a TOC left in place would be
narrated as story.

**Block-level TOC pages.** A page whose blocks are mostly TOC entry lines ("Chapter 1",
"IV. The Storm", "1. Arrival", dotted leaders) is skipped too. Three rules, each with its
own density threshold: a dense TOC with little prose, a short-line index where three
quarters of the lines are short, or a page where almost every line is an entry. Block
classification for headings additionally counts a short heading beginning with
chapter/part/book as an entry.

**Leading TOC blocks.** When a TOC and Chapter 1 share one HTML file, the leading run of
TOC entries is cut (only when the run is at least three blocks, so a single "Chapter One"
line is not mistaken for a TOC). Short blank-ish headings inside the run are treated as
filler; the first paragraph of 20+ words ends it.

**Back matter.** A heading like "Notes", "Appendix", or "Bibliography" marks the end of
the main text — but only past 60% of the spine and only once at least a book's worth of
words has been seen. Without both conditions, a mid-book part titled "Notes" would
truncate the rest of the book. Everything after the latch is dropped.

**Front-matter bodies.** A page with no recognizable heading can still be front matter: a
lone dedication or epigraph, a praise/review page (many short blocks, no long prose), or
a page of quoted pieces. Note that the short page branch (≤2 blocks, ≤60 words) is
pre-empted in practice by the 400-word gate that guards its only call site, so it only
fires for pages that already look like prose.

## Chapter aggregation

The first accepted page becomes "Chapter 1", so it must be the real start of the story.
A page clears the gate when its heading starts with prologue/chapter/volume/part/book,
when its filename carries a chapter/part signal, or when it holds at least 400 words that
do not read as front matter. Pages that clear the front-matter and TOC filters but not
this gate are **held**, not dropped; they are promoted in spine order only when no page
in the whole book ever tripped the gate. This path exists because an OCR'd EPUB splits a
book into per-page spine files whose word counts never trip the signal, and discarding
them all would reject the entire book. Pages of 50 words or fewer are dropped as
non-prose either way.

A spine whose median file is page-sized is a scan split per page — hundreds of ~300-word
files, and a book is not 535 chapters — so consecutive pages merge until the chapter
reaches 2500 words. A spine of chapter-sized files keeps one chapter per file. Either
way a page carrying a heading opens a chapter, and a chapter never breaks mid-sentence:
the page that continues a sentence joins the chapter it belongs to. Chapter titles fall
back to `Chapter N` when the page heading is the book title or a front-matter title. The
chapter count is capped, and hitting the cap fails the parse rather than truncating.

## Text and blocks

`cleanText` collapses newlines and runs of whitespace, strips `[12]`-style citation
markers, and normalizes smart quotes to ASCII. Blocks are `<p>`, `<h1>`–`<h6>`, and
`<blockquote>`; `script`, `style`, `img`, `svg`, page-break markers, and footnote
superscripts that are links are removed before extraction. Under 60 characters and equal
to the book title is a running header, not prose; bare page numbers ("42", "… 42") are
dropped. A block is typed by tag and attributes first (heading, footnote, poem, letter)
and falls back to dialogue when it opens or closes with a quote or starts with an em-dash
or "- ".

Page headings are read from `<h1>`–`<h3>` first, but many EPUBs put them on
`<p class="partTitle">` or `<div class="chapterHead">` instead, so any element whose class
matches `title` or `head` also counts — under 120 characters, and never when the text is
just the book title again. The heading decides both the chapter title and whether a page
is front matter, so missing it would silently misclassify the page.

Word counts have one spelling, `countWords`: trimmed, split on whitespace, empty is zero.
Historic call sites split cleaned text with and without a `filter(Boolean)`; for cleaned
non-empty text both give the same number, so the parser uses the one spelling.

## Test fixtures and regressions

`testFixture.ts` builds the mock EPUBs. Options cover DC vs `<meta name>` vs
non-`dc:`-prefixed vs absent metadata, an empty spine, a missing container, and the
OCR-style paginated spine: N per-page files with no headings and under the 400-word
threshold, which is the shape that once produced "only 0 words" on a book with plenty of
prose. The paginated fixture also backs the regression that one chapter per spine file
turned a 500-page scan into 535 "chapters", 150 of them ending mid-sentence; the merge
test asserts every chapter now ends at a sentence boundary, including the Devanagari
danda. Beyond the checked-in tests, the split was verified against the pre-split parser
with a differential harness over 66 generated EPUB variants comparing result, thrown
message, and console output.

`parseEpub` logs its progress (skipped pages, held pages, the page-based-spine decision,
the final chapter/word summary) and warns when a spine file is missing from the archive;
those messages are observed behavior, not debugging leftovers.
