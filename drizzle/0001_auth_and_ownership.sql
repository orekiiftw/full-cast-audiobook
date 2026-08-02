CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL,
  "password_hash" text NOT NULL,
  "disabled" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "token_hash" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_user_id_expires_at_idx" ON "sessions" ("user_id", "expires_at");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- A disabled account preserves pre-authentication data without making it accessible
-- through login. The unusable password value is intentionally not an Argon2 hash.
INSERT INTO "users" ("id", "email", "password_hash", "disabled")
VALUES ('00000000-0000-0000-0000-000000000001', 'legacy-migration@invalid.local', '!disabled-legacy-account!', true)
ON CONFLICT ("email") DO UPDATE SET "disabled" = true;
--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "user_id" uuid;
--> statement-breakpoint
UPDATE "books" SET "user_id" = (
  SELECT "id" FROM "users" WHERE "email" = 'legacy-migration@invalid.local' LIMIT 1
) WHERE "user_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "books" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "books" ADD CONSTRAINT "books_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "books" DROP CONSTRAINT IF EXISTS "books_source_hash_unique";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "books" ADD CONSTRAINT "books_user_id_source_hash_unique" UNIQUE ("user_id", "source_hash");
EXCEPTION WHEN duplicate_object THEN null;
END $$;
