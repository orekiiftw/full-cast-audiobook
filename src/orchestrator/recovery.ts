/**
 * Boot recovery: temp-dir cleanup, counter repair, and re-enqueueing of all
 * queued segments — makes "restart the server" sufficient recovery for any
 * queue-level loss.
 */
import * as fs from "fs/promises";
import * as path from "path";
import { tmpdir } from "os";
import { asc, sql } from "drizzle-orm";
import { db } from "../db";
import { segments } from "../schema";
import { TEMP } from "../lib/constants";
import { enqueueSegmentJobs } from "../queue";
import { queuedSegmentsQuery, runPipelineSweep } from "./sweep";

/**
 * Best-effort sweep of orphaned pipeline temp dirs (seg_tts_*, seg_regen_*,
 * stitch_*) left behind by crashed workers. Only removes dirs older than
 * TEMP.SWEEP_AGE_MS so a still-running job is never touched.
 */
async function cleanupStaleTempDirs() {
  let entries: string[];
  try {
    entries = await fs.readdir(tmpdir());
  } catch (err) {
    console.warn("⚠️ Could not scan os.tmpdir() for stale pipeline dirs:", err);
    return;
  }

  const now = Date.now();
  let removed = 0;
  for (const entry of entries) {
    if (!TEMP.DIR_PREFIXES.some((prefix) => entry.startsWith(prefix))) continue;
    const fullPath = path.join(tmpdir(), entry);
    try {
      const stat = await fs.stat(fullPath);
      if (!stat.isDirectory()) continue;
      if (now - stat.mtimeMs < TEMP.SWEEP_AGE_MS) continue;
      await fs.rm(fullPath, { recursive: true, force: true });
      removed++;
    } catch {
      // best-effort: ignore per-entry failures
    }
  }
  if (removed > 0) {
    console.log(`🧹 Swept ${removed} stale pipeline temp dir(s) from os.tmpdir().`);
  }
}

/**
 * Boot-time recovery. Multi-instance safe: unlike the old in-process version
 * it does NOT blanket-reset mid-flight rows — another instance may be
 * legitimately processing them. Live jobs are owned by BullMQ (stalled
 * recovery re-runs dead workers' jobs within ~a minute); rows whose job is
 * gone entirely are handled by the sweep, which also runs once here.
 */
export async function resumePendingWork() {
  console.log("🔄 Checking for pending pipeline work...");

  await cleanupStaleTempDirs();

  // Recompute chapter counters from ground truth. Atomic increments keep them
  // exact at runtime; this boot-time sweep repairs anything left inconsistent
  // by a crash (e.g. segments force-failed without bumping counters).
  await db.execute(sql`
    UPDATE chapters c
    SET total_count = COALESCE(s.total, 0),
        voiced_count = COALESCE(s.voiced, 0),
        failed_count = COALESCE(s.failed, 0)
    FROM (
      SELECT chapter_id,
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE status = 'voiced')::int AS voiced,
             COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
      FROM segments
      GROUP BY chapter_id
    ) s
    WHERE c.id = s.chapter_id
  `);
  await db.execute(sql`
    UPDATE chapters c
    SET total_count = 0, voiced_count = 0, failed_count = 0
    WHERE NOT EXISTS (SELECT 1 FROM segments s WHERE s.chapter_id = c.id)
  `);

  // Re-enqueue every queued segment of every in-progress book. Deterministic
  // jobIds make this idempotent: jobs still in Redis are not duplicated, and
  // jobs lost to a Redis flush are recreated. This is what makes "restart the
  // server" sufficient recovery for any queue-level loss. ("pending" rows are
  // deliberately untouched: they have no job by design — the lookahead window
  // promotes them only as listening approaches.)
  let offset = 0;
  const PAGE = 5000;
  for (;;) {
    const queuedRows = await queuedSegmentsQuery()
      .orderBy(asc(segments.id))
      .limit(PAGE)
      .offset(offset);
    if (queuedRows.length === 0) break;
    await enqueueSegmentJobs(queuedRows);
    offset += queuedRows.length;
    if (queuedRows.length < PAGE) break;
  }
  if (offset > 0) {
    console.log(`♻️ Re-enqueued ${offset} queued segment job(s) from the DB.`);
  }

  // One immediate sweep for orphaned mid-flight rows, due stitches, and
  // stuck ingestions (the periodic sweep continues from here).
  await runPipelineSweep();
}
