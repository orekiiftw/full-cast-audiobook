# Narratea — AI Narrated Audiobook Performance System

Narratea is a production-ready system running on the Bun runtime that transforms standard EPUB ebooks into emotional, narrator-performed audiobooks using Google's Gemini text model (emotional beat annotation) and Xiaomi's MiMo speech model (TTS synthesis), PostgreSQL, Drizzle ORM, and Cloudflare R2 storage.

## Key Features
- **Automatic Torrent Discovery**: Search for ebooks automatically by typing a title and author using the TorBox Search API.
- **Single Narrator Performance**: Every book is voiced by one warm storyteller voice (MiMo's built-in "Mia"). No casting step means ingestion starts voicing immediately and a whole class of casting failures is gone.
- **Emotional Beat Direction**: A director-style LLM annotates each segment with fine-grained emotional beats (whispered, fearful, intensity, pacing — max 1 emotion shift per ~3 sentences), which the narrator then performs.
- **Pronunciation Subscriptions**: User-defined phonetic substitutions for fantasy terms or complex names are injected directly into synthesis inputs.
- **Fast Time-to-First-Audio**: Each chapter opens with a small lead-in segment (~70 words) that is voiced in seconds, so playback can start almost immediately.
- **Progressive Playback**: Chapters unlock as soon as their first segment is ready. Playback continues progressively in the web player while subsequent sections generate in the background.
- **Just-in-Time Voicing**: Only the segment being listened to and the next `LOOKAHEAD_SEGMENTS` (4) are synthesized ahead of the listener, across chapter boundaries, so TTS spend follows playback instead of the whole book.
- **Dynamic Segment Redo**: Adjust emotional beats or pronunciation for any paragraph on the fly directly from the reading interface.
- **Cinema-Inspired Interface**: Sleek dark premium theme with gold highlights, smooth easing transitions, and detailed performance event consoles.

---

## System Requirements
- **Bun**: v1.0.0 or later
- **PostgreSQL**: v14 or later
- **Redis**: v6 or later (durable pipeline queue — BullMQ). Quickest local option: `docker run -d -p 6379:6379 redis:7`
- **FFmpeg & FFprobe**: Required for audio normalization and stitching

---

## Project Structure
```
src/
├── server.ts  main.tsx     # Bun HTTP entry, static SPA hosting + /api delegation; browser entry
├── db.ts  schema.ts        # Postgres pool + Drizzle ORM schema
├── queue/                  # BullMQ/Redis: connection, queues, enqueue, workers, events, locks
├── auth.ts  environment.ts  staticFiles.ts
├── api/                    # HTTP layer
│   ├── route.ts  router.ts  csrf.ts  errors.ts  rateLimit.ts
│   ├── response.ts  body.ts  ownership.ts
│   └── routes/             # books, chapters, segments, audio, cast, playback, pronunciation, events (SSE)
├── acquisition/            # Finding and fetching EPUBs
│   ├── index.ts  types.ts  errors.ts  registry.ts  ranking.ts  catalogue.ts
│   └── providers/          # One file per source: archiveOrg, gutenberg, libgen, annaArchive, torrent
├── torrent/                # TorBox API + fallback indexers, ranking, SSRF guards, torrent/IPFS downloads
├── epub/                   # EPUB parsing: archive guards, OPF metadata, spine, chapters, filters, text
├── narration/              # Text -> performance
│   ├── annotation/         # Emotional-beat direction via Gemini (prompt, response, beats)
│   ├── tts/                # Speech synthesis: MiMo + Sarvam providers, retries, rate limiting
│   ├── voiceSegment.ts     # Parallel beat synthesis + in-memory WAV merge
│   ├── voiceContext.ts     # Per-book narrator/pronunciation cache
│   └── segmenter.ts        # Chapter -> narration segment splitting
├── audio/                  # WAV math (wav.ts), chapter stitching (stitch.ts), ffmpeg process handling
├── storage/                # Cloudflare R2 with local ./.storage fallback (r2/, keys.ts)
├── orchestrator/           # Background pipeline: ingestion/ and segment/ phases, stitch, sweep, recovery
├── lib/                    # Shared helpers: constants, api client, format, language, readStream, validators
├── hooks/                  # useSSE, useAuthSession, usePlaybackSession, useSleepTimer, useAudioPlayer
├── components/             # Screens (App-level): Player, BookDetail, Library, AuthScreen
│   ├── player/             # Transport controls, transcript, playback hooks
│   ├── bookDetail/         # Chapter list, narrator card, pronunciation editor
│   ├── library/  auth/     # Library and auth screen pieces
│   └── ui/                 # Button, Badge, Card, Modal, Toast, ProgressBar, Skeleton, Icon
└── types/api.ts            # Shared API/domain types
```

Rationale that used to live in code comments is collected in [`ARCHITECTURE.md`](ARCHITECTURE.md).

### Installing FFmpeg

#### Linux (Debian/Ubuntu)
```bash
sudo apt update
sudo apt install ffmpeg -y
```

#### macOS (Homebrew)
```bash
brew install ffmpeg
```

#### Windows (Chocolatey)
```cmd
choco install ffmpeg
```

---

## Getting Started

### 1. Configure Environment Variables
Copy `.env.example` to `.env` and fill in your API tokens and database credentials:
```bash
cp .env.example .env
```

Ensure you configure:
- `DATABASE_URL`: PostgreSQL connection string.
- `REDIS_URL`: Redis connection string (default `redis://127.0.0.1:6379`). The pipeline (ingestion, narration, stitching) runs as durable BullMQ jobs on Redis: work survives server crashes, retries with durable backoff, and can be processed by multiple server instances. Enable AOF persistence (`appendonly yes`) so queued work also survives a Redis restart; boot recovery re-enqueues from Postgres regardless.
- `GEMINI_API_KEY`: API credentials from Google AI Studio (used for emotional beat annotation).
- `MIMO_API_KEY`: API key from the [Xiaomi MiMo console](https://platform.xiaomimimo.com/console/api-keys) (used for TTS synthesis — see the [MiMo speech synthesis docs](https://mimo.mi.com/docs/usage-guide/speech-synthesis-v2.5)). `MIMO_TS_MODEL` (default `mimo-v2.5-tts`) and `MIMO_TS_BASE_URL` (default `https://api.xiaomimimo.com/v1`) are optional overrides; set `MIMO_TS_MODEL=mimo-v2.5-tts-voicedesign` to narrate with a voice described in natural language instead of a built-in voice.
- `TORBOX_API_KEY`: API credentials from TorBox (required for torrent caching/downloads).
- `BOOK_PROVIDERS_ENABLED`: Comma-separated reviewed acquisition providers (default: `torrent,archive-org,gutenberg,libgen`). `anna-archive` is deliberately disabled until a vetted sidecar adapter replaces its fail-closed stub; see [`ARCHITECTURE.md`](ARCHITECTURE.md).
- `BOOK_SEARCH_CACHE_TTL_MS`, `BOOK_SEARCH_MAX_RESULTS`, `PREFERRED_LANGUAGES`, and `PREFERRED_FORMATS`: Provider-search cache and ranking policy controls.
- `BOOK_SEARCH_BUDGET_MS`: How long `POST /api/book-search` may take in total (default 15000). Providers that miss the budget are reported as `pending` instead of failing the request.
- `R2_*`: Cloudflare R2 storage credentials (optional; the app falls back to local `./.storage/` folder if unset).
- `HOST` / `PORT`: Bind address (default `127.0.0.1:3000`). Keep it on loopback unless you're ready to expose it; the API requires an authenticated session cookie (email + password signup/login stored in a same-origin HttpOnly cookie).
- `CORS_ORIGIN`: Optional. Allow one external origin to call the API cross-origin. Unset by default (the SPA is served same-origin, and cross-site browser requests are rejected by fetch-metadata CSRF guards).
- `TRUST_PROXY`: Set to `true` when behind a reverse proxy so client IPs are read from `X-Forwarded-For` and the original scheme from `X-Forwarded-Proto` (used by the CSRF origin check and HSTS; without it, same-origin POSTs through a TLS-terminating proxy are rejected). The proxy **must** overwrite any client-supplied `X-Forwarded-For` and `X-Forwarded-Proto`; the server trusts `TRUST_PROXY_HOPS` (default `1`) hops from the right (closest to the real client), never the first spoofable entry.
- `INSECURE_HTTP`: Session cookies are always `Secure`, so browsers keep them over HTTPS (Chrome and Firefox also on `http://localhost`). Set `INSECURE_HTTP=true` only to sign in over plain HTTP on a trusted network, e.g. from another device via a LAN IP.
- `REGISTRATION_ENABLED`: Set to `true` to allow new-account signup. Defaults to closed — enable it to create your account(s), then remove it (or set `false`) before exposing the server beyond loopback.
- `SESSION_MAX_AGE_MS`: Optional absolute cap on session lifetime (bounded above by the 30-day rolling TTL; e.g. `86400000` = 1 day). A stolen cookie stops being honored once it is older than this. Sessions are also rotated on every login, revoking prior sessions, so a cookie stolen before a login is invalidated immediately.
- `MAX_WORKERS_PER_BOOK`, `INGESTION_CONCURRENCY`, `STITCH_CONCURRENCY`: Optional per-instance pipeline worker concurrency (defaults 3 / 2 / 2). These bound how many BullMQ jobs one instance processes at once.
- `MEDIA_TOKEN_SECRET`: HMAC key for the signed audio URLs that native clients play. Set a random value (e.g. `openssl rand -base64 32`) in production; when it is unset the server generates a per-process secret and logs one warning, which means signed URLs stop working after a restart and are not valid across instances.
- `MEDIA_TOKEN_TTL_SECONDS`: Lifetime of a signed media URL in seconds (default `21600`, 6 hours).

### Durable pipeline & multiple instances

Postgres owns pipeline **state** (segment/chapter/book status); Redis owns **scheduling** (ordering, retries, distribution). Crashed work is recovered in layers: BullMQ stalled-job detection (~30s), a maintenance sweep every 5 minutes (orphaned rows, queue refill after Redis data loss, due stitches, stuck ingestions), and boot-time re-enqueue of all queued segments. To run multiple instances, point every instance at the same Postgres and Redis and start them normally — job dedupe (deterministic job IDs) and the atomic DB segment claim prevent double work; progress events fan out to all instances over Redis pub/sub. Note the login rate limit, book-search throttle, upload concurrency cap, and SSE connection caps remain per-instance.

### 2. Install Node Dependencies
Run the installation command in your terminal:
```bash
bun install
```

### 3. Initialize the Database
Push the database schema directly to PostgreSQL using Drizzle Kit (this creates the `users` and `sessions` tables used by authentication):
```bash
bun run db:push
```

### 4. Verify TypeScript

Verify strict TypeScript correctness at any time:
```bash
bun run typecheck
```

### 5. Launch the Server
To run the project locally:
```bash
# Build the production react assets and start the Bun server
bun run start
```
Navigate to `http://localhost:3000` to start using Narratea!

For local frontend hot-reloading:
```bash
# Start Vite development server
bun run dev:client
```
Navigate to `http://localhost:5173`. Frontend API calls are automatically proxied to the Bun server on port 3000.

## Native clients

The web app authenticates with an HttpOnly session cookie, which a native client (React Native/Expo) cannot rely on: cookies do not attach to an audio player, and `EventSource` cannot set headers. The API therefore accepts the same session as a bearer token and hands out short-lived signed URLs for media. All of it is additive — a browser that sends cookies sees exactly the same responses as before.

### 1. Log in and keep the token

Send `client: "native"` in the JSON body of `POST /api/auth/login` or `POST /api/auth/signup`:

```http
POST /api/auth/login
{ "email": "you@example.com", "password": "...", "client": "native" }
```

```json
{
  "user": { "id": "…", "email": "you@example.com" },
  "token": "<session token>",
  "expiresAt": "2026-12-23T09:00:00.000Z"
}
```

The `Set-Cookie` header is still sent, and without the `client` field (or with any other value) the body is unchanged. `token` is the raw session the cookie would carry, so the same rules apply: 30-day rolling TTL (or the `SESSION_MAX_AGE_MS` cap), rotated on every login, revoked by `POST /api/auth/logout`. Store it in the platform keychain rather than as plain text.

### 2. Send the token as a header

```
Authorization: Bearer <token>
```

Every route that accepts the cookie accepts this header; when a request carries both, the header wins. Bearer requests skip the CSRF guard entirely — a cross-origin page cannot set `Authorization`, so there is no ambient credential to forge, while cookie-authenticated requests keep the same `Sec-Fetch-Site`/`Origin` checks as before. `CORS_ORIGIN` deployments allow the header in preflight.

### 3. Ask for signed media URLs

Audio players take a URL, not a header:

```http
POST /api/media-tokens
Authorization: Bearer <token>
{ "keys": ["books/<bookId>/chapters/chapter_1.mp3"] }
```

```json
{
  "urls": { "books/<bookId>/chapters/chapter_1.mp3": "/api/audio?key=…&exp=1750000000&sig=…" },
  "expiresAt": "2026-11-23T15:00:00.000Z"
}
```

Each call takes 1–50 storage keys the caller owns (segment `audioUrl` and chapter audio keys come from the segments/chapters endpoints). A malformed key is a 400, a key you do not own is a 404. The URLs are relative — join them with your API base — and need no session, so they work from a player with no headers, range requests and seeking included. They stay valid until the shared `exp` (`MEDIA_TOKEN_TTL_SECONDS`, default 6 hours); asking again before then is the refresh path. `GET /api/chapters/:chapterId/audio` also answers a Bearer request with a signed `Location`, so following that redirect plays without a cookie.

### 4. Live pipeline events

`GET /api/books/:bookId/events` accepts the Bearer header, and also `?token=<session token>` for clients whose `EventSource` cannot set headers. The token belongs in the query only for that connection and must never be logged. The 8-stream-per-user cap and the 15-second heartbeat are unchanged.

## Deployment

`main` is the deploy branch. GitHub Actions runs format, typecheck, tests and the client build on every push and pull request, and on the VPS a two-minute systemd timer pulls `origin/main` once that commit's checks are green, then installs dependencies, builds the client, runs migrations and restarts `narratea.service`. Details, logs and rollback: [deploy/vps/README.md](deploy/vps/README.md).
