-- Pipeline performance: chapter terminal-state counters + queue-scan indexes.
-- (Hand-written so it can also backfill counters for existing rows.
-- NOTE: kept partial-index-free because drizzle-kit 0.21 breaks on them.)

ALTER TABLE "chapters" ADD COLUMN IF NOT EXISTS "total_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN IF NOT EXISTS "voiced_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN IF NOT EXISTS "failed_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chapters_book_id_status_idx" ON "chapters" ("book_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "segments_chapter_id_status_idx" ON "segments" ("chapter_id","status");
--> statement-breakpoint
-- Status index for the queue-fill scan (WHERE status='queued').
CREATE INDEX IF NOT EXISTS "segments_status_idx" ON "segments" ("status");
--> statement-breakpoint
-- Backfill counters for chapters that already have segments.
UPDATE "chapters" c
SET "total_count" = COALESCE(s.total, 0),
    "voiced_count" = COALESCE(s.voiced, 0),
    "failed_count" = COALESCE(s.failed, 0)
FROM (
  SELECT "chapter_id",
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE "status" = 'voiced')::int AS voiced,
         COUNT(*) FILTER (WHERE "status" = 'failed')::int AS failed
  FROM "segments"
  GROUP BY "chapter_id"
) s
WHERE c."id" = s."chapter_id";
