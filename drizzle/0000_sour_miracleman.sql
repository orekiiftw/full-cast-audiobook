CREATE TABLE IF NOT EXISTS "books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"author" text NOT NULL,
	"cover_r2_key" text,
	"source_hash" text NOT NULL,
	"epub_r2_key" text,
	"status" text DEFAULT 'discovering' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "books_source_hash_unique" UNIQUE("source_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cast_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"name" text NOT NULL,
	"aliases" text[] NOT NULL,
	"importance" text NOT NULL,
	"voice_bucket" text NOT NULL,
	"tts_voice_name" text NOT NULL,
	"style_string" text NOT NULL,
	"pronunciation_notes" text,
	CONSTRAINT "cast_members_book_id_name_unique" UNIQUE("book_id","name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"chapter_index" integer NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"audio_r2_key" text,
	"duration_ms" integer,
	CONSTRAINT "chapters_book_id_chapter_index_unique" UNIQUE("book_id","chapter_index")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "playback_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"chapter_id" uuid NOT NULL,
	"position_ms" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "playback_state_book_id_chapter_id_unique" UNIQUE("book_id","chapter_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pronunciation_dict" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"term" text NOT NULL,
	"phonetic_hint" text NOT NULL,
	CONSTRAINT "pronunciation_dict_book_id_term_unique" UNIQUE("book_id","term")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chapter_id" uuid NOT NULL,
	"segment_index" integer NOT NULL,
	"raw_text" text NOT NULL,
	"annotated_json" jsonb,
	"speaker_cast_id" uuid,
	"audio_r2_key" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"is_scene_break" integer DEFAULT 0 NOT NULL,
	"scene_summary" text,
	CONSTRAINT "segments_chapter_id_segment_index_unique" UNIQUE("chapter_id","segment_index")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cast_members" ADD CONSTRAINT "cast_members_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chapters" ADD CONSTRAINT "chapters_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "playback_state" ADD CONSTRAINT "playback_state_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "playback_state" ADD CONSTRAINT "playback_state_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pronunciation_dict" ADD CONSTRAINT "pronunciation_dict_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "segments" ADD CONSTRAINT "segments_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "segments" ADD CONSTRAINT "segments_speaker_cast_id_cast_members_id_fk" FOREIGN KEY ("speaker_cast_id") REFERENCES "public"."cast_members"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
