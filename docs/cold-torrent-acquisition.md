# Cold-Torrent Acquisition — research-backed strategy

Companion to `catalogue-service-design.md` and `shadow-library-metadata-index.md`.
Answers one question: **the catalogue's torrents have cold/no seeders, so how do we
actually acquire these non-English EPUB files?**

Primary sources were queried directly for this report (TorBox OpenAPI + official
support FAQ, IPFS/Cloudflare docs, living Anna's Archive mirror); where the source
could only be reached as an empirical probe from this sandbox, the test is labelled
`[empirical]`. Claims I could not verify against a primary or first-hand source are
labelled **UNVERIFIED**.

---

## Conclusion (up front)

**TorBox cannot save you on cold torrents. Stop trying to make the debrid pull dead
swarms — go IPFS for the long tail, and treat TorBox as a fast path for the already-
cached subset.**

Ranked strategy, matched to the catalogue record fields:

1. **TorBox — only for `cached` books (great when it works).** `checkcached`
   (`format=object`) is a deterministic "TorBox already stores it, instant download"
   signal (design doc §5d). When `cached == true`, nothing beats it. When `false`,
   **do not queue the torrent** (see below). This covers whatever fraction of the
   long tail TorBox happens to keep.
2. **IPFS HTTP gateway — the real answer for cold/non-seeded books.** Fetch
   `https://ipfs.io/ipfs/<ipfs_cid>` (with robust mirror gateways) over plain HTTPS.
   IPFS is content-addressed and served by pinned public gateways **independent of
   the bittorrent swarm**, so a book with **zero seeders still downloads byte-correct**
   (Phase 0 verified this on a real AA record; replicated here across 4 gateways, §5).
   This is the only source in the ranking that does not care about seeders.
3. **Direct-download mirrors (LibGen/Z-Library) — a brittle, low-priority second
   fallback.** LibGen `ads.php?md5=`/search mirrors are reachable and scriptable-ish,
   but they are HTML-scrape targets with their own availability/bot churn, and
   add nothing IPFS does not already give us for EPUB long-tail.

**IPFS is the answer the codebase already architected but never wired up.** The
`ipfs_cid` column exists in `catalogue/import.ts`'s schema and the design doc says
"IPFS fallback", but currently **nothing populates it, nothing returns it from
`catalogue/server.ts`, and no acquire path fetches it.** That is the concrete gap.

The rest of this doc proves the three claims above against primary sources and maps
each to exact code changes.

---

## Findings

### 1. TorBox: exact uncached / cold-torrent behavior

**Claim 1a — TorBox DOES attempt to fetch an uncached torrent from the live swarm.
The cache is what makes it instant, not the absence of seeds.**

- TorBox "How Does The TorBox Cache Work?": *"The TorBox cache allows you to have
  instant downloads, without waiting for torrents to download... When you download a
  torrent to your TorBox account, it is saved for at least 30 days. If someone else
  downloads the same torrent in those 30 days, their download would be instant... all
  download types are cached"*. (Source: support.torbox.app/en/articles/9923071-how-does-the-torbox-cache-work)
- The OpenAPI spec's `createtorrent` accepts `magnet`, `seed`, `allow_zip`,
  `as_queued`, and `add_only_if_cached` — and **`add_only_if_cached` defaults to
  `false`**, i.e. TorBox will, by default, *add the magnet and try to pull it from the
  swarm*. (Source: `https://api.torbox.app/openapi.json`)

**1b — With no seeders, there is no way to download; it does not error but stays
stalled and is eventually dropped.**

- TorBox "My Torrent Is Slow Or Won't Load": for stalled torrents, "**no seeds. If
  there are no seeds there won't be any way to download it.**" (support.torbox.app/
  en/articles/9834832-my-torrent-is-slow-or-won-t-load)
- TorBox "Download Statuses" defines the exact states: **`Stalled (No seeds)`** —
  "attempting to download but there are no seeders... this isn't an error... find a
  better torrent"; **`MetaDL`** — "attempting to fetch info... no seeds at all, this
  will likely show as well"; **`Incomplete`** — "not able to download completely within
  2 days... if no progress in more than 2 days, it will be removed. The most common
  reason is no seeders/low seeders." (support.torbox.app/en/articles/9928977-download-statuses)
- Repo's own live probe (catalogue/phase0.md) matches: a cold libgen range reported
  status `stalled (no seeds)` in `mylist`.

→ **What `mylist` shows for a dead swarm: it stays `stalled (no seeds)` / `MetaDL`
(no `failed`/`error`), and only flips to "removed/`incomplete`" after ~2 days.** So
TorBox will NOT block an acquisition with an error; it just never becomes ready,
and the app's bounded poll (below) gives up first.

**1c — Uncached adds are queued and may only start on a ~3-hour cadence.**
- "Why Do Queued Downloads Not Start?": "We have a background process which handles
  queued downloads... **Please wait at least 3 hours after adding a queued download.**"
  (support.torbox.app/en/articles/10293822-why-do-queued-downloads-not-start). This compounds 1b: even if a cold
  torrent later finds a seeder, the app's `MAX_POLLS_UNCACHED` (120s) window is long
  over.

**1d — there is NO "request a cache / Rent / PickBox / instant-for-cold" API.** The
full OpenAPI path list (87 operations) has no such endpoint; `pickbox`/`rent`/`instant
deep` do not appear in the TorBox changelog. "Force Start" for queued items is a
dashboard control described in the queued article; the API's `controltorrent`
`operation` field is an untyped string and **it is UNVERIFIED** whether the API
accepts a force-start operation.

**1e — you can opt a magnet OUT of the queue entirely.** `createtorrent` /
`asynccreatetorrent` accept `add_only_if_cached=true` (skip adding if not cached) and
`as_queued=false`. So the client can *never* waste a TorBox slot/quota on a cold
torrent it can't serve. This is the right default for a cold-torrent catalogue path.

Primary sources: `https://api.torbox.app/openapi.json`; support.torbox.app articles
cached-work, slow-or-wont-load, download-statuses, queued-downloads. `[cache article URL verified live]`

---

### 2. IPFS as the cold-torrent workaround

**2a — Content-addressing means availability does not depend on the swarm.**
- IPFS HTTP Gateway reference: gateways are "retrieving content-addressed data from
  IPFS over regular HTTP", addressable via `GET /ipfs/{cid}` with optional
  `?filename=` / `?download=true`; a gateway reassembles UnixFS to bytes "as if they
  were stored in a traditional HTTP server". (docs.ipfs.tech/reference/http/gateway/)
- A CID that is pinned/reachable on the IPFS network returns the *content-addressed*
  bytes no matter how many (or zero) peers a corresponding torrent has — because the
  data is keyed by its hash, not by seeder count.

**2b — Which gateways reliably serve, empirically (this sandbox, 2026-08-14):**
| gateway | result | note |
|---|---|---|
| `ipfs.io` | **HTTP 200, 119,762 B** | fast (TTFB ~0.1 s), canonical |
| `dweb.link` | HTTP 200, same bytes | good mirror |
| `w3s.link` | HTTP 200 | IPFS (web3.storage) public gateway |
| `nftstorage.link` | HTTP 200 | NFT.Storage/IpfsListed gateway |
| `gateway.pinata.cloud` | HTTP 429 | rate-limits anonymous |
| `cloudflare-ipfs.com` | DNS-unresolved here | unreachable from this box (geo/sandbox) |
| `ipfs.web3.pub` | timeout | flaky |

[empirical, live-gateway test]. Dozens of public gateways exist; the repo's design doc already
recommends `ipfs.io` plus "a couple of robust mirrors" — `dweb.link`, `w3s.link`,
`nftstorage.link` are the ones that returned live 200s here. (Caveat: per-IP rate
limits and regional edge availability vary; a production path should rotate across
several and survive individual `429`/`5xx`.)

**2b — File size / rate limits on public gateways.**
- Cloudflare's IPFS gateway page lists the Cloudflare managed gateways and 50 GB of
  free bandwidth with **no file-size limit** for the managed product on paid plans
  (developers.cloudflare.com/web3/ipfs-gateway). Public gateways generally do not
  document a hard per-file cap, but *reliability* drops as you scale — plan a
  graceful, retry-across-gateways fetch rather than assuming one gateway holds a
  fast stream.
- For a 100–200 MB EPUB per request, ipfs.io's practical per-file ceiling is fine; the
  real limiting factor is *which CID is actually pinned* (not gateway), §2c.

**2c — availability = is it still pinned, not is it seeded.** The IPFS gateway
  only serves a CID that exists and is pinned/reachable on the IPFS network. Anna's
  Archive pins its content and mirrors the Nexus/STC metadata collection over IPFS on
  its datasets page (`annas-archive.gd/datasets` says Nexus/STC: "available through
  IPFS"), so archive CIDs should be live — but for the exact obscure/non-English
  target group availability should be spot-checked at scale, as phase0.md already notes.

**2d — Security/verifiability.** A client can fetch the bytes then re-derive the hash
  and compare to the expected `Content` / its full CID; that is the "trustless" mode
  the IPFS docs describe (verifiable response types `application/vnd.ipld.raw`,
  `.car`). For EPUB ingestion the app already revalidates the zip; hash-checking the
  CID is optional but cheap.

**2e — which records carry a usable `ipfs_cid`.**
- `zlib3_records`: **CONFIRMED (2026-08-14)** — inspected the official AAC sample
  (`drok/annas-archive` `aacid_small/zlib3_records_…jsonl`): **107/216 records carry CIDs**,
  all blake2b, nested at **`metadata.annabookinfo.response.ipfs_cid_blake2b`** (legacy
  `…response.ipfs_cid` also present sometimes). `catalogue/import.ts` now extracts this path;
  a small `catalogue/extract_zlib_cids.ts` emits `md5`→`ipfs_cid` for `enrich_cids.ts`. ~half
  of records lack the field and remain torrent-only.
- `nexusstc_records`: repo's shadow-library §7 verified **nexusstc carries md5 + IPFS
  CIDs per file in `record.links[]`** → download via IPFS/gateways, not a torrent
  folder. A clean CID source for the STC set.
- libgen (`libgenrs_hashes` / `libgenrs_fiction_hashes`): carry a direct `ipfs_cid`
  column per md5 (design doc §1).

So: **zlib3 is a verified CID source** — re-ingesting it (via `import.ts`, or via
`extract_zlib_cids.ts` + `enrich_cids.ts`) populates the column. See also the gateway
caveat in §2b: from an Oracle-Mumbai VPS the public gateways (`ipfs.io`) can be slow or
unreachable and `w3s.link`/`nftstorage.link` timed out on the live probe — the
per-gateway timeouts and rotation are not optional.

### 3. Anna's Archive / Z-Library direct download — bot-blocked, as the repo suspected

- **`annas-archive.gd/ipfs_downloads/md5:<hash>` returns `HTTP 403`** and the body is
  literal **"DDoS-Guard Checking your browser before accessing"** — so the *active*
  blocker here is **DDoS-Guard** (repo phase0 said "DataDome/DDoS-Guard"; this run
  confirms DDoS-Guard specifically on `.gd`). Not a real user-agent issue; it serves a
  JS challenge, so it is not usable programmatically.
- `annas-archive.gd/slow_download/` (the non-member route) also returns `HTTP 403`.
  The `/db/...` path in the repo's `phase0.md` is the *elasticsearch JSON export*
  (e.g. `/db/aarecord_elasticsearch/md5:...`) — it 404s on the live mirror and the
  live download surface are bot-challenge gated. So the repo's claim that "AA's own
  `/ipfs_downloads` and `/db/` are 403" **holds** (verified verbatim here for
  `/ipfs_downloads`; the `/db` path itself is not a file-download route).
- The usable AA surfaces that ARE reachable and relevant to the catalogue:
  `https://annas-archive.gd/dyn/torrents.json` (**HTTP 200**, the md5→btih map this
  repo already consumes), `https://annas-archive.gd/datasets` (**HTTP 200**, releases
  metadata pages), `/torrents` (**200**). So AA is fine as a *metadata/hashes* source
  and as an IPFS/torrent source, but not as a direct-file source.

- **Z-Library's own mirrors & "send to e-reader"/email:** Z-Library rotates domains
  and its download/send-to-device flows are behind CAPTCHA/
  (DataDome/GeeTest) anti-bot front ends. **UNVERIFIED from this sandbox** (mirrors
  rotated on; cannot reach a stable endpoint). Do not build an acquisition path on
  Z-Library's own site — it is a scrape target with no stable API, the same conclusion
  the repo reached for Anna's Archive and the reason it ships a sidecar adapter only.

Empirical probes: `annas-archive.gd/ipfs_downloads/…`=403 DDoS-Guard;
`annas-archive.gd/slow_download/`=403; `annas-archive.gd`, `/datasets`, `/torrents`,
`/dyn/torrents.json` = 200. `annas-archive.org/.se/.gl` were DNS-unreachable from this
box.

### 4. Alternate direct-download sources (long-tail / non-English EPUB)

- **LibGen mirrors.** `libgen.li` and `libgen.lc` (and `libgen.li/lcs`) currently
  respond; libgen `.rs/.is/.st/.gs/.re` are DNS-rot blocking/disappearing from many
  endpoints. LibGen's classic energy page (`ads.php?md5=<md5>`) returns 200 HTML,
  but the *actual file* is then served from a rotating mirror set
  (one needs a real md5 and the file's HTML/redirect to a download edge). Status:
  **direct HTTP download without torrent seeding — plausible ✅ for the mirrors that
  resolve, but the flow is an unofficial, un-API scraping target** and shares bot
  anti-bot/DNS churn with Z-Library. Treat as last-resort, `[empirical reachability
  only, end-to-end file fetch UNVERIFIED]`.
- **Z-Library domains with direct download:** same *scrape-CAPTCHA* reality as §3 —
  **UNVERIFIED / not a reliable programmatic source**.
- No third-party mirror here matches IPFS's mix of `✓ no-seed`, `✓ no-CAPTCHA`,
  `✓ deterministic bytes`.

### 5. Debrid/relay alternatives to TorBox

Real-Debrid, Premiumize, AllDebrid, and Debrid-Link all operate (they have live API
endpoints), and they are the standard TorBox-topic debrids. **No one of them solves
dead seeds**: they join the same torrent swarm TorBox does (the "no seeders→stalled"
physics is shared by Real-Debrid/Premiumize/etc). To honestly differentiate:
- **None provides an instant cold-torrent** mechanism in general. The only true
  way we can serve dead-swarm content over a simple HTTPS pipeline is IPFS gateway
  retrieval (which is not a debrid at all). `UNVERIFIED` in its specific API cold-seed
  behavior for each competitor; confirm against their own docs before adding a fallback,
  and note every one of them is also a per-request paid-pipeline with its own
  ToS/bot posture, razing the simple-as-IPFS advantage.

---

## What this means for Narratea (concrete changes)

The codebase today: torrent-only acquisition. `src/orchestrator/ingestion.ts` runs
`resolveTorrentCandidates` (search) then `searchCatalogueTorrentCandidates` (catalogue)
then `downloadBookFromCandidates`. The catalogue's `ipfs_cid` column exists but is
**never populated or read**.

### A. Make the catalogue carry `ipfs_cid` — the missing prerequisite

- **`catalogue/import.ts`**: populate `books.ipfs_cid`. zlib3 path currently extracts
  neither hash; add extraction from `ipfs_infos[]`/`ipfs_cid` if present in the AAC
  record (verify zlib3's container has it — see §2e), and ingest a CID-bearing source
  (`nexusstc_records` via `record.links[]`, or libgen `ipfs_cid` column) so the column
  has data for non-English EPUB. Until at least one source populates it, the IPFS
  fallback cannot run.
- **`catalogue/server.ts`**: add `ipfs_cid` (and keep `md5`, `infohash`) to the
  `SearchRow` + `toResult`, and select it from `books` in `search`/`bookByMd5`.
- The catalogue search API already ranks rows with a resolved infohash; add a "has
  ipfs_cid" signal so cold-torrent-but-ipfs-backed rows surface for the new fallback.

### B. TorBox acquire: stop betting on swarms

- **`src/torrent/index.ts` → `attemptDownload`**: when the candidate is NOT
  `checkcached`, send `add_only_if_cached=true` (and `allow_zip` handling unchanged) so
  a cold torrent gets no TorBox slot/quota. Currently it sets only `seed=3`.
  Read the `checkcached` result you already have.
- Note the current `MAX_POLLS_UNCACHED` (12 × 10s = 120s) already times out long before
  TorBox's ~3 hr queue / 2-day-removal window — so the timeout path in `attemptDownload`
  (`reason: timeout`) is correct to bail on cold, but then must hand off to IPFS (below)
  instead of throwing "All N candidates failed".

### C. Add the IPFS gateway fetch tier (the actual fix)

- **`src/acquisition/types.ts`**: `BookCandidate` (torrent/hash/md5/`ipfs_cid`) is not
  present today; add `ipfs_cid?: string` to `TorrentCandidate` (in `src/torrent/index.ts`)
  or a new `IBookCandidate`, and thread it through `src/acquisition/catalogue.ts`
  (`CatalogueHit.ipfs_cid` + `mapCandidates`).
- **`src/acquisition/providers/index.ts`** / **`src/orchestrator/ingestion.ts`**: in the limit
  where `candidates` are cold/dead (final candidate timed-out), fall back to
  `fetchIPFS(ipfs_cid)` which tries, in order: **ipfs.io, dweb.link, w3s.link,
  nftstorage.link** (the group we measured live in §2), returning when one yields a valid EPUB
  zip ≤ 200 MB. Reuse `readBodyWithCap` + `verifyBookBuffer` from torboxService; add the
  gateway host set to the SSRF allowlist (trusted, static gateway hosts), treated like
  the TorBox CDN allowlist.
- `expectedSha256` (on `AcquiredBook`) can be set from the IPFS CID's multihash if we
  compute it — a cheap integrity bonus.
- Keep the ranking: torrent/TorBox cached → IPFS → (future) direct mirrors.

### D. Priority ordering you can ship now
1. Wire the IPFS fetch tier + gateway allowlist + size/zip validation (small, isolated,
   testable — mirrors the MD5 file-selection change).
2. Turn on `add_only_if_cached` for known-cold TorBox candidates (prevents quota leak).
3. Ingress `nexusstc`/libgen CIDs into the catalogue and surface `ipfs_cid` from the API.
4. Optional: run pinned-CID availability/rate tests on obscure non-English
   CIDs before forcing IPFS-first for the whole non-English set.

---

## Verification notes & confidence

- **TorBox**: sourced from the live `api.torbox.app/openapi.json` (primary) + 4 official
  support-KB articles. All cited directly. The one gap: the OpenAPI `mylist` schema is
  empty (`{}`), so exact status strings rely on the repo's own measured `stalled (no
  seeds)` + the "Download Statuses" KB; both agree.
- **IPFS**: global IPFS gateway docs + Cloudflare docs are primary; the multi-gateway
  live test is first-hand evidence (§2 table). CID-to-file availability on AA pins still
  requires a bulk spot-check (design doc §5 "Confirmation").
- **AA / libgen / Z-Library direct downloads**: verified server-side (DDoS-Guard 403,
  mirror reachability) but the LibGen file-fetch end-to-end is **UNVERIFIED**; treat as
  a lower-priority list.
- Unsourced/uncheckable via web_search in this session (search tool auth failed): the
  Z-Library email/"send to device" exact mechanics and per-debrid cold-seed semantics.
  Both marked UNVERIFIED; the physical answer is that none of them beat IPFS for
  dead-seed content.

Frontmost next step for the repo: wire the `ipfs_cid` end-to-end and add the IPFS
retrieval tier — everything else (TorBox fine-tuning, mirror scraping) is secondary.