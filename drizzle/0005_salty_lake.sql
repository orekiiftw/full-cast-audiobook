-- The reason a book failed, in words the owner can act on, plus the raw pipeline error.
-- A failed ingestion used to keep only its status; the cause (a rejected TorBox token, a
-- fallback that sent a web page) was lost, so every failure read the same in the UI.
ALTER TABLE "books" ADD COLUMN "failure_reason" jsonb;
