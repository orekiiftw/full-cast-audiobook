# The pipeline and its queue

`src/orchestrator/` is the background pipeline: it turns an acquired EPUB into voiced,
stitched chapter audio, and keeps that work moving when workers, Redis or the process
die. `src/queue/` is the BullMQ side of it — Redis connections, the four queues, job
submission, the lock and coalescing primitives, the progress-event bridge.

Nothing outside `api/`, `server.ts` and `queue/` imports `orchestrator/`; inside it,
`index.ts` is the public surface, phase folders expose their own `index.ts`.

## Files

| File                          | Responsibility                                                        |
| ----------------------------- | --------------------------------------------------------------------- |
| `queue/connection.ts`         | Redis URL parsing, the two shared clients, the boot ping              |
| `queue/queues.ts`             | Job payload types, the four queue instances, job ids, bulk removal    |
| `queue/enqueue.ts`            | Job submission, terminal-job dedupe, the stitch-pending flag          |
| `queue/events.ts`             | Progress publish, cluster-wide voice invalidation, the subscriber bridge |
| `queue/locks.ts`              | Token-checked distributed locks with a TTL                            |
| `queue/workers.ts`            | Worker construction, sweep schedule, shutdown                         |
| `orchestrator/ingestion/`     | Acquire → parse → structure chapters and segments → schedule voicing  |
| `orchestrator/segment/`       | One segment: claim → annotate beats → synthesize → publish counters   |
| `orchestrator/stitch.ts`      | Stitch a chapter once its segments are terminal, with re-stitch coalescing |
| `orchestrator/chapterCounters.ts` | The chapter counter shape, its increments, and the stitch gate    |
| `orchestrator/sweep.ts`       | Periodic reconciliation between Postgres and the queues               |
| `orchestrator/recovery.ts`    | Boot recovery: temp dirs, counters, re-enqueue, then a full sweep     |
| `orchestrator/lookahead.ts`   | Playback-driven prefetch and job priority lifting                     |
| `orchestrator/lifecycle.ts`   | Book deletion, retry, and the book-level completion rollup            |

## Job options are the contract

Segment jobs: 5 attempts, exponential backoff from 5s, `removeOnComplete: true`,
`removeOnFail: { count: 1000 }`, and `priority = chapterIndex` so earlier chapters
drain first. Stitch jobs: 5 attempts, fixed 60s backoff, `removeOnFail: { count: 100 }`.
Ingestion jobs: 1 attempt, removed on both outcomes — book-level retry is explicit, never
automatic. The maintenance queue repeats every 5 minutes. Concurrency is 2 ingestion,
`MAX_WORKERS_PER_BOOK` (3) segments, 2 stitch, 1 maintenance.

Job ids are the dedupe key: ingestion is keyed by book id, a segment job by segment id, a
stitch job by chapter id. BullMQ ignores an `add` whose job id already exists in any
state, so every submit calls `clearTerminalJob` first: a completed or failed job with the
same id is removed, otherwise the new work would be silently dropped.

## Why the voicing window re-centers

`ensureLookahead(bookId, anchor)` selects the next `LOOKAHEAD_SEGMENTS` (4) unfinished
segments at or after the listener's `(chapterIndex, segmentIndex)`. It re-centers on
every playback sync because a window fixed at the book's start stops being useful the
moment the listener moves; the anchor is the position the listener is actually about to
consume. Segments already queued in that window get their BullMQ priority changed to
`LOOKAHEAD_PRIORITY` (0, the highest), and pending rows are promoted to `queued` and
enqueued.

The work is throttled per book and chapter for 2 seconds. That is deliberate: the
playback route calls it on every sync, and a listener crossing several segments inside
one chapter should not pay a database query per segment. The throttle map is cleared
when it exceeds 5000 keys so it cannot grow without bound.

## Why lookahead is chapter-scoped

`ensureChapterLookahead(bookId, chapterIndex)` covers chapters N and N+1 only, throttled
per chapter with its own 10-second window. Chapters, not segments, are what the listener
consumes: the next chapter has to be ready before the current one ends, but segments two
chapters ahead may never be played, and voicing them spends TTS budget on audio nobody
hears. `prefetchNextChapter` lifts the next chapter's queued jobs to the current
chapter's priority band (batching the `changePriority` calls 64 at a time) so that
chapter drains immediately after the current one instead of waiting behind every later
chapter — and it refuses to run at all while the current chapter still has queued,
processing or annotated segments, which keeps the current chapter strictly ahead.

## Partial readiness

`PARTIAL_READY_THRESHOLD` is 1. A chapter becomes `partial_ready` when its first
`threshold` segments are all terminal (`voiced` or `failed`) and at least one of them is
voiced; for a chapter at or below the threshold that reduces to "all terminal, at least
one voiced". This is what lets playback start while the rest of the chapter is still
being voiced. `maybeMarkPartialReady` never overwrites `ready`, `partial_ready` or
`failed` — a chapter that advanced past the window is not downgraded. A chapter whose
leading window is terminal but contains nothing voiced does not become `partial_ready`;
it waits for the stitch pass, which either makes the chapter `ready` from the segments
that did voice or fails it.

## Stall recovery

Postgres is the source of truth; BullMQ is a cache that can lose jobs to a Redis flush, a
redeploy or eviction. The periodic sweep (every 5 minutes) reconciles the queue back to
the database:

- **Orphaned mid-flight segments** — a row in `processing` or `annotated` is orphaned
  when no `regen:` lock is held and its BullMQ job is missing or in a terminal state.
  Effective attempts are `row.attempts + 1` when the job state is `failed`, because a
  failed BullMQ job has already consumed an attempt that the row does not record yet. At
  or past `MAX_SEGMENT_ATTEMPTS` the segment is marked failed and the chapter's failed
  counter is incremented (which may complete the chapter); below it, the row is set back
  to `queued` with the recovered attempt count and re-enqueued.
- **Stranded queued segments** — queued rows whose jobs are gone are re-materialized;
  the job-id dedupe keeps this safe to run repeatedly.
- **Refill** — when the summed `wait`, `active`, `delayed` and `prioritized` counts fall
  below `QUEUED_REFILL_WATERMARK` (100), queued rows are enqueued again to keep workers
  fed.
- **Counter-terminal stitches** — a crash between a counter update and `enqueueStitch`
  leaves a chapter whose counters say "done" with no stitch job; the sweep enqueues one.
- **Stuck ingestions** — a book still in `discovering` or `casting` after an hour with no
  live ingestion job is marked failed, with a "use retry" event. Ingestion is a single
  attempt job, so this is the only thing that resolves an ingestion that died mid-run.

Every sweep phase is capped (500 orphaned, 200 stranded, 2000 refill, 500 stitch
candidates, 200 stuck ingestions) so one sweep cannot become an unbounded scan; work
beyond the cap is picked up by the next sweep.

Boot runs `resumePendingWork` before workers start: stale temp directories older than an
hour are removed, chapter counters are recomputed from the segments table, every queued
segment row is re-enqueued page by page in id order, and a full sweep follows. Failure
there is non-fatal — the periodic sweep retries the same reconciliation.

## Stitch coalescing

A chapter's stitch job id is the chapter id, so concurrent stitch requests collapse into
one job. Requests that arrive while a stitch is running cannot create a second job, so
`enqueueStitch` sets a `narratea:stitch-pending:<chapterId>` flag with a 5-minute TTL.
`runStitchJob` discards the flag before its first pass, and after a pass that actually
stitched it consumes the flag to see whether another request landed meanwhile; if so it
runs again, up to `MAX_STITCH_RERUNS` (5), after which it does one final fresh pass and
drops further requests. The cap keeps a hot chapter from looping forever, and the TTL
bounds how long a stale flag can extend the chain.

A stitch pass is skipped, not failed, while a chapter is short of its terminal counters.
It only marks a chapter failed when the chapter has no segments at all, or when every
segment failed. If the stitch itself throws, the job's own attempts drive the retry, and
exhaustion marks the chapter failed — unless it already went `ready` in the meantime.

## Counters and the stitch gate

`chapters.totalCount` is written at ingestion; `voicedCount` and `failedCount` are
incremented by the segment worker and the sweep, both guarded by `status != 'voiced'` /
`status != 'failed'` so a duplicate execution cannot double-count. The stitch gate is
`totalCount > 0 && voicedCount + failedCount >= totalCount`, shared by the segment worker,
the segment failure path and the sweep, so all three agree on when a chapter is finished.
A segment job that fails *after* it already voiced the segment does not fail the segment:
it recomputes the chapter's counters from the segments table and re-runs the gate, because
the failure was in bookkeeping, not in the audio.

The book rolls up from its chapters in `maybeMarkBookComplete`: once every chapter is
terminal, a book with at least one `ready` chapter becomes `ready`, otherwise `failed`.

## Ingestion failure and retry

An ingestion failure records `status = failed`, and when the EPUB was uploaded in that
same run the key is written back onto the book row before the failure is reported, so a
retry reuses the uploaded object instead of re-acquiring it. If the book row is gone
(deleted mid-ingestion) the object is purged instead. Deletion while the job is
mid-flight is tolerated the same way: if the metadata write finds no row, the freshly
uploaded EPUB is purged and the job returns quietly.

`retryFailedBook` claims the book with a conditional update (`failed` → `discovering`) so
two concurrent retries cannot both proceed, deletes the chapters, cast and pronunciation
rows, purges orphaned audio asynchronously, and enqueues ingestion with an empty source
when the EPUB is still stored — otherwise it starts a fresh title/author search.

Failure messages are normalized for the reader: torrent and TorBox errors become
"could not download", EPUB parse errors become "could not be parsed", word-count
rejections pass through, and anything else becomes a generic ingestion failure.
