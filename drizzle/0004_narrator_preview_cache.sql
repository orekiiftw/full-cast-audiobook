-- Single-narrator voice preview cache. A preview costs a paid TTS call and
-- several seconds; cache it on the narrator row keyed by (voice, style) and
-- serve the bytes instead of re-synthesizing on every click.
ALTER TABLE "cast_members" ADD COLUMN IF NOT EXISTS "preview_audio" text;
ALTER TABLE "cast_members" ADD COLUMN IF NOT EXISTS "preview_voice_key" text;
ALTER TABLE "cast_members" ADD COLUMN IF NOT EXISTS "preview_gen" integer DEFAULT 0 NOT NULL;
