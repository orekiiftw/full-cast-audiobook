CREATE TABLE IF NOT EXISTS "book_search_cache" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "query" text NOT NULL,
  "normalized_query" text NOT NULL,
  "provider" text NOT NULL,
  "response_json" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp NOT NULL,
  CONSTRAINT "book_search_cache_query_provider_unique" UNIQUE("normalized_query", "provider")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "book_search_cache_expires_at_idx" ON "book_search_cache" ("expires_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "book_metadata" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider" text NOT NULL,
  "provider_book_id" text NOT NULL,
  "isbn" text,
  "title" text NOT NULL,
  "authors" text[] DEFAULT '{}' NOT NULL,
  "language" text,
  "publisher" text,
  "year" integer,
  "cover" text,
  "formats" text[] DEFAULT '{}' NOT NULL,
  "download_information" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "last_verified" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "book_metadata_provider_book_id_unique" UNIQUE("provider", "provider_book_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "book_metadata_isbn_idx" ON "book_metadata" ("isbn");
