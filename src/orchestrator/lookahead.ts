import { and, asc, eq, gt, gte, inArray, or } from "drizzle-orm";
import { db } from "../db";
import { chapters, segments } from "../schema";
import { PIPELINE } from "../lib/constants";
import { enqueueSegmentJobs, segmentJobId, segmentQueue, type SegmentJobData } from "../queue";

const LOOKAHEAD_THROTTLE_MS = 2_000;

const MAX_THROTTLED_BOOKS = 5_000;

const PRIORITY_LIFT_BATCH_SIZE = 64;

const lookaheadThrottle = createBookThrottle(LOOKAHEAD_THROTTLE_MS, MAX_THROTTLED_BOOKS, (bookId, anchor) => {
  evaluateWindow(bookId, anchor).catch((err) =>
    console.error(`Deferred lookahead failed for book ${bookId} ch ${anchor.chapterIndex} seg ${anchor.segmentIndex}:`, err),
  );
});

interface LookaheadAnchor {
  chapterIndex: number;
  segmentIndex: number;
}

const BOOK_START: LookaheadAnchor = { chapterIndex: 1, segmentIndex: 1 };

export async function ensureLookahead(bookId: string, anchor: LookaheadAnchor = BOOK_START): Promise<void> {
  if (!lookaheadThrottle.admit(bookId, anchor)) return;
  await evaluateWindow(bookId, anchor);
}

async function evaluateWindow(bookId: string, anchor: LookaheadAnchor): Promise<void> {
  try {
    const windowRows = await loadLookaheadWindow(bookId, anchor);
    await liftJobPriorities(queuedIds(windowRows), PIPELINE.LOOKAHEAD_PRIORITY);
    await promotePendingSegments(windowRows, bookId);
  } catch (err) {
    lookaheadThrottle.release(bookId);
    throw err;
  }
}

interface LookaheadWindowRow {
  segmentId: string;
  chapterId: string;
  chapterIndex: number;
  segmentIndex: number;
  status: string;
}

// Voiced and failed rows still occupy window slots. Counting only unfinished rows would let the
// window creep forward each time a buffered section finished voicing, with the listener standing still.
function loadLookaheadWindow(bookId: string, anchor: LookaheadAnchor): Promise<LookaheadWindowRow[]> {
  return db
    .select({
      segmentId: segments.id,
      chapterId: chapters.id,
      chapterIndex: chapters.chapterIndex,
      segmentIndex: segments.segmentIndex,
      status: segments.status,
    })
    .from(segments)
    .innerJoin(chapters, eq(segments.chapterId, chapters.id))
    .where(
      and(
        eq(chapters.bookId, bookId),
        or(
          gt(chapters.chapterIndex, anchor.chapterIndex),
          and(eq(chapters.chapterIndex, anchor.chapterIndex), gte(segments.segmentIndex, anchor.segmentIndex)),
        ),
      ),
    )
    .orderBy(asc(chapters.chapterIndex), asc(segments.segmentIndex))
    .limit(PIPELINE.LOOKAHEAD_SEGMENTS + 1);
}

async function promotePendingSegments(windowRows: LookaheadWindowRow[], bookId: string): Promise<void> {
  const pendingIds = pendingSegmentIds(windowRows);
  if (pendingIds.length === 0) return;

  const promoted = await db
    .update(segments)
    .set({ status: "queued" })
    .where(and(inArray(segments.id, pendingIds), eq(segments.status, "pending")))
    .returning({ id: segments.id });
  if (promoted.length === 0) return;

  await enqueueFromWindow(windowRows, promoted, bookId);
}

function queuedIds(windowRows: LookaheadWindowRow[]): string[] {
  return windowRows.filter((row) => row.status === "queued").map((row) => row.segmentId);
}

function pendingSegmentIds(windowRows: LookaheadWindowRow[]): string[] {
  return windowRows.filter((row) => row.status === "pending").map((row) => row.segmentId);
}

interface BookThrottle {
  admit(bookId: string, anchor: LookaheadAnchor): boolean;
  release(bookId: string): void;
}

interface ThrottledBook {
  evaluatedAt: number;
  anchor: LookaheadAnchor;
  deferred?: LookaheadAnchor;
  timer?: ReturnType<typeof setTimeout>;
}

// Keyed by book alone, so varying the anchor cannot multiply evaluations. A moved anchor that lands
// inside the window is held and evaluated once the window closes (latest anchor wins), so it is
// delayed but never lost. The map stays ordered by last evaluation: expired books are pruned from
// the front, and a full map evicts its least recently evaluated book instead of resetting them all.
function createBookThrottle(
  throttleMs: number,
  maxBooks: number,
  evaluateDeferred: (bookId: string, anchor: LookaheadAnchor) => void,
): BookThrottle {
  const books = new Map<string, ThrottledBook>();

  // A wall clock that steps backwards counts as expired, rather than holding the book until it catches up.
  function remainingMs(entry: ThrottledBook, now: number): number {
    const elapsed = now - entry.evaluatedAt;
    return elapsed < 0 || elapsed >= throttleMs ? 0 : throttleMs - elapsed;
  }

  function stamp(bookId: string, anchor: LookaheadAnchor, now: number): void {
    const previous = books.get(bookId);
    if (previous?.timer) clearTimeout(previous.timer);
    books.delete(bookId);
    books.set(bookId, { evaluatedAt: now, anchor });
    for (const [oldestId, oldest] of books) {
      const idle = !oldest.timer && remainingMs(oldest, now) === 0;
      if (!idle && books.size <= maxBooks) break;
      if (oldest.timer) clearTimeout(oldest.timer);
      books.delete(oldestId);
    }
  }

  function flushDeferred(bookId: string): void {
    const entry = books.get(bookId);
    if (!entry) return;
    entry.timer = undefined;
    const anchor = entry.deferred;
    if (!anchor) return;
    stamp(bookId, anchor, Date.now());
    evaluateDeferred(bookId, anchor);
  }

  return {
    admit(bookId: string, anchor: LookaheadAnchor): boolean {
      const now = Date.now();
      const entry = books.get(bookId);
      const waitMs = entry ? remainingMs(entry, now) : 0;
      if (!entry || waitMs === 0) {
        stamp(bookId, anchor, now);
        return true;
      }
      entry.deferred = sameAnchor(anchor, entry.anchor) ? undefined : anchor;
      if (entry.deferred && !entry.timer) {
        entry.timer = setTimeout(() => flushDeferred(bookId), waitMs);
        entry.timer.unref?.();
      }
      return false;
    },
    release(bookId: string): void {
      const entry = books.get(bookId);
      if (entry) entry.evaluatedAt = Number.NEGATIVE_INFINITY;
    },
  };
}

function sameAnchor(left: LookaheadAnchor, right: LookaheadAnchor): boolean {
  return left.chapterIndex === right.chapterIndex && left.segmentIndex === right.segmentIndex;
}

async function enqueueFromWindow(windowRows: LookaheadWindowRow[], promoted: Array<{ id: string }>, bookId: string): Promise<void> {
  const promotedIds = new Set(promoted.map((row) => row.id));
  const tasks: SegmentJobData[] = windowRows
    .filter((row) => promotedIds.has(row.segmentId))
    .map((row) => ({
      bookId,
      chapterId: row.chapterId,
      chapterIndex: row.chapterIndex,
      segmentId: row.segmentId,
      segmentIndex: row.segmentIndex,
    }));
  try {
    await enqueueSegmentJobs(tasks, PIPELINE.LOOKAHEAD_PRIORITY);
  } catch (err) {
    await db
      .update(segments)
      .set({ status: "pending" })
      .where(and(inArray(segments.id, [...promotedIds]), eq(segments.status, "queued")))
      .catch(() => {});
    throw err;
  }
}

async function liftJobPriorities(segmentIds: string[], priority: number): Promise<void> {
  for (let start = 0; start < segmentIds.length; start += PRIORITY_LIFT_BATCH_SIZE) {
    await Promise.allSettled(
      segmentIds.slice(start, start + PRIORITY_LIFT_BATCH_SIZE).map(async (segmentId) => {
        const job = await segmentQueue.getJob(segmentJobId(segmentId));
        if (job) await job.changePriority({ priority });
      }),
    );
  }
}
