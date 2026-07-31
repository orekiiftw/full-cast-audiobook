# Narratea — AI Narrated Audiobook Performance System

Narratea is a production-ready system running on the Bun runtime that transforms standard EPUB ebooks into emotional, narrator-performed audiobooks using Google's Gemini text model (emotional beat annotation) and Xiaomi's MiMo speech model (TTS synthesis), PostgreSQL, Drizzle ORM, and Cloudflare R2 storage.

## Key Features
- **Automatic Torrent Discovery**: Search for ebooks automatically by typing a title and author using the TorBox Search API.
- **Single Narrator Performance**: Every book is voiced by one warm storyteller voice (MiMo's built-in "Mia"). No casting step means ingestion starts voicing immediately and a whole class of casting failures is gone.
- **Emotional Beat Direction**: A director-style LLM annotates each segment with fine-grained emotional beats (whispered, fearful, intensity, pacing — max 1 emotion shift per ~3 sentences), which the narrator then performs.
- **Pronunciation Subscriptions**: User-defined phonetic substitutions for fantasy terms or complex names are injected directly into synthesis inputs.
- **Fast Time-to-First-Audio**: Each chapter opens with a small lead-in segment (~70 words) that is voiced in seconds, so playback can start almost immediately.
- **Progressive Playback**: Chapters unlock as soon as their first segment is ready. Playback continues progressively in the web player while subsequent sections generate in the background.
- **Playback Prefetching**: Automatically prioritizes performance synthesis for chapter N+1 when playback for chapter N begins.
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
├── server.ts              # Bun HTTP entry: static SPA hosting + /api delegation
├── queue.ts               # BullMQ/Redis queues, workers, job dedupe, locks, SSE event bridge
├── orchestrator.ts        # Pipeline processors: ingestion -> annotation -> TTS -> stitch
├── api/
│   ├── router.ts          # Modular API router (ValidationError -> 400)
│   ├── response.ts        # json / cors / binary response helpers
│   └── routes/            # books, chapters, segments, audio, cast, playback, pronunciation, events (SSE)
├── *Service.ts            # epub, torbox, segmentation, annotation, tts, stitching
├── r2.ts                  # Cloudflare R2 storage with local ./.storage fallback
├── schema.ts / db.ts      # Drizzle ORM schema + Postgres pool
├── lib/                   # constants (browser-safe env access), validators,
│                          # format helpers, voiceSegment
│                          # (parallel beat synthesis + in-memory WAV merge),
│                          # bookCache (per-book narrator/pronunciation cache),
│                          # sessionHint (optimistic signed-in boot marker)
├── hooks/                 # useSSE (auto-reconnect), useAudioPlayer
├── components/            # Library, BookDetail, Player
│   └── ui/                # Button, Badge, Card, Modal, Toast, ProgressBar, Skeleton, Icon
└── types/api.ts           # Shared API/domain types
```

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
- `BOOK_PROVIDERS_ENABLED`: Comma-separated reviewed acquisition providers (default: `torrent`). `anna-archive` is deliberately disabled until a vetted sidecar adapter replaces its fail-closed stub; see [`docs/acquisition-architecture.md`](docs/acquisition-architecture.md).
- `BOOK_SEARCH_CACHE_TTL_MS`, `BOOK_SEARCH_MAX_RESULTS`, `PREFERRED_LANGUAGES`, and `PREFERRED_FORMATS`: Provider-search cache and ranking policy controls.
- `R2_*`: Cloudflare R2 storage credentials (optional; the app falls back to local `./.storage/` folder if unset).
- `HOST` / `PORT`: Bind address (default `127.0.0.1:3000`). Keep it on loopback unless you're ready to expose it; the API requires an authenticated session cookie (email + password signup/login stored in a same-origin HttpOnly cookie).
- `CORS_ORIGIN`: Optional. Allow one external origin to call the API cross-origin. Unset by default (the SPA is served same-origin, and cross-site browser requests are rejected by fetch-metadata CSRF guards).
- `TRUST_PROXY`: Set to `true` when behind a reverse proxy so client IPs are read from `X-Forwarded-For`. The proxy **must** overwrite any client-supplied `X-Forwarded-For`; the server trusts `TRUST_PROXY_HOPS` (default `1`) hops from the right (closest to the real client), never the first spoofable entry.
- `REGISTRATION_ENABLED`: Set to `true` to allow new-account signup. Defaults to closed — enable it to create your account(s), then remove it (or set `false`) before exposing the server beyond loopback.
- `SESSION_MAX_AGE_MS`: Optional absolute cap on session lifetime (bounded above by the 30-day rolling TTL; e.g. `86400000` = 1 day). A stolen cookie stops being honored once it is older than this. Sessions are also rotated on every login, revoking prior sessions, so a cookie stolen before a login is invalidated immediately.
- `MAX_WORKERS_PER_BOOK`, `INGESTION_CONCURRENCY`, `STITCH_CONCURRENCY`: Optional per-instance pipeline worker concurrency (defaults 3 / 2 / 2). These bound how many BullMQ jobs one instance processes at once.

### Durable pipeline & multiple instances

Postgres owns pipeline **state** (segment/chapter/book status); Redis owns **scheduling** (ordering, retries, distribution). Crashed work is recovered in layers: BullMQ stalled-job detection (~30s), a maintenance sweep every 5 minutes (orphaned rows, queue refill after Redis data loss, due stitches, stuck ingestions), and boot-time re-enqueue of all queued segments. To run multiple instances, point every instance at the same Postgres and Redis and start them normally — job dedupe (deterministic job IDs) and the atomic DB segment claim prevent double work; progress events fan out to all instances over Redis pub/sub. Note the login rate limit and SSE connection caps remain per-instance.

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

### 4. Diagnostics check
Run the diagnostic script to verify services compile and that `ffmpeg`/`ffprobe` are correctly installed on the system:
```bash
bun run test:pipeline
```

You can also verify strict TypeScript correctness at any time:
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
