import * as fs from "fs/promises";
import * as path from "path";
import { tmpdir } from "os";
import { asc, sql } from "drizzle-orm";
import { db } from "../db";
import { segments } from "../schema";
import { TEMP } from "../lib/constants";
import { enqueueSegmentJobs } from "../queue";
import { queuedSegmentsQuery, runPipelineSweep } from "./sweep";

const REENQUEUE_PAGE_SIZE = 5_000;

export async function resumePendingWork(): Promise<void> {
  console.log("🔄 Checking for pending pipeline work...");

  await cleanupStaleTempDirs();
  await repairChapterCounters();
  await reenqueueQueuedSegments();

  await runPipelineSweep();
}

async function cleanupStaleTempDirs(): Promise<void> {
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
    } catch {}
  }

  if (removed > 0) {
    console.log(`🧹 Swept ${removed} stale pipeline temp dir(s) from os.tmpdir().`);
  }
}

async function repairChapterCounters(): Promise<void> {
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
}

async function reenqueueQueuedSegments(): Promise<void> {
  let lastSegmentId: string | undefined;
  let total = 0;

  for (;;) {
    const queuedRows = await queuedSegmentsQuery(lastSegmentId).orderBy(asc(segments.id)).limit(REENQUEUE_PAGE_SIZE);
    if (queuedRows.length === 0) break;

    await enqueueSegmentJobs(queuedRows);
    total += queuedRows.length;
    lastSegmentId = queuedRows[queuedRows.length - 1].segmentId;
    if (queuedRows.length < REENQUEUE_PAGE_SIZE) break;
  }

  if (total > 0) {
    console.log(`♻️ Re-enqueued ${total} queued segment job(s) from the DB.`);
  }
}
