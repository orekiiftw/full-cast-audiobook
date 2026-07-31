import { pgTable, uuid, text, integer, timestamp, unique, jsonb, boolean, index } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

export const bookSearchCache = pgTable("book_search_cache", {
  id: uuid("id").primaryKey().defaultRandom(),
  query: text("query").notNull(),
  normalizedQuery: text("normalized_query").notNull(),
  provider: text("provider").notNull(),
  responseJson: jsonb("response_json").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
}, (t) => ({
  lookup: unique("book_search_cache_query_provider_unique").on(t.normalizedQuery, t.provider),
  expiry: index("book_search_cache_expires_at_idx").on(t.expiresAt),
}));

export const bookMetadata = pgTable("book_metadata", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull(),
  providerBookId: text("provider_book_id").notNull(),
  isbn: text("isbn"),
  title: text("title").notNull(),
  // NOTE: .default([]) on text[] breaks drizzle-kit 0.21 DDL serialization
  // (emits "DEFAULT  NOT NULL" → syntax error on fresh db:push). SQL literal works.
  authors: text("authors").array().notNull().default(sql`'{}'::text[]`),
  language: text("language"),
  publisher: text("publisher"),
  year: integer("year"),
  cover: text("cover"),
  formats: text("formats").array().notNull().default(sql`'{}'::text[]`),
  downloadInformation: jsonb("download_information").notNull().default({}),
  lastVerified: timestamp("last_verified").defaultNow().notNull(),
}, (t) => ({
  providerBook: unique("book_metadata_provider_book_id_unique").on(t.provider, t.providerBookId),
  isbn: index("book_metadata_isbn_idx").on(t.isbn),
}));

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  disabled: boolean("disabled").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userExpiryIdx: index("sessions_user_id_expires_at_idx").on(t.userId, t.expiresAt),
}));

// 1. Books Table
export const books = pgTable("books", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  title: text("title").notNull(),
  author: text("author").notNull(),
  coverR2Key: text("cover_r2_key"),
  sourceHash: text("source_hash").notNull(), // EPUB hash or Torrent hash
  epubR2Key: text("epub_r2_key"),
  status: text("status", { enum: ["discovering", "casting", "in_progress", "ready", "failed"] }).notNull().default("discovering"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  unqUserSource: unique("books_user_id_source_hash_unique").on(t.userId, t.sourceHash),
}));

// 2. Cast Members Table
export const castMembers = pgTable("cast_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookId: uuid("book_id").references(() => books.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  aliases: text("aliases").array().notNull(), // Aliases text[]
  importance: text("importance", { enum: ["main", "minor"] }).notNull(),
  voiceBucket: text("voice_bucket", {
    enum: ["male_young", "male_adult", "male_old", "female_young", "female_adult", "female_old"]
  }).notNull(),
  ttsVoiceName: text("tts_voice_name").notNull(),
  styleString: text("style_string").notNull(),
  pronunciationNotes: text("pronunciation_notes"),
  // Single-narrator preview cache. Synthesizing a preview costs a paid TTS
  // call and takes seconds; the audio for a given (voice, style) pair is
  // deterministic enough to reuse. Guarded by previewGen so an invalidate
  // racing an in-flight synthesis can never serve a stale clip.
  previewAudio: text("preview_audio"),
  previewVoiceKey: text("preview_voice_key"),
  previewGen: integer("preview_gen").notNull().default(0),
}, (t) => ({
  unqBookName: unique().on(t.bookId, t.name),
}));

// 3. Pronunciation Dictionary Table
export const pronunciationDict = pgTable("pronunciation_dict", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookId: uuid("book_id").references(() => books.id, { onDelete: "cascade" }).notNull(),
  term: text("term").notNull(),
  phoneticHint: text("phonetic_hint").notNull(),
}, (t) => ({
  unqBookTerm: unique().on(t.bookId, t.term),
}));

// 4. Chapters Table
export const chapters = pgTable("chapters", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookId: uuid("book_id").references(() => books.id, { onDelete: "cascade" }).notNull(),
  chapterIndex: integer("chapter_index").notNull(),
  title: text("title").notNull(),
  status: text("status", {
    enum: ["queued", "processing", "partial_ready", "ready", "failed"]
  }).notNull().default("queued"),
  audioR2Key: text("audio_r2_key"),
  durationMs: integer("duration_ms"),
  // Terminal-state counters maintained atomically by the pipeline. They
  // replace re-scanning every segment of a chapter on each completion event
  // (previously O(segments²) row reads per chapter).
  totalCount: integer("total_count").notNull().default(0),
  voicedCount: integer("voiced_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
}, (t) => ({
  unqBookChapter: unique().on(t.bookId, t.chapterIndex),
  bookStatus: index("chapters_book_id_status_idx").on(t.bookId, t.status),
}));

// 5. Segments Table
export const segments = pgTable("segments", {
  id: uuid("id").primaryKey().defaultRandom(),
  chapterId: uuid("chapter_id").references(() => chapters.id, { onDelete: "cascade" }).notNull(),
  segmentIndex: integer("segment_index").notNull(),
  rawText: text("raw_text").notNull(),
  annotatedJson: jsonb("annotated_json"), // { scene_summary?, beats: [...] } or legacy beats array
  speakerCastId: uuid("speaker_cast_id").references(() => castMembers.id, { onDelete: "set null" }),
  audioR2Key: text("audio_r2_key"),
  // "pending" = planned but intentionally NOT scheduled yet (lookahead window
  // hasn't reached it); "queued" = has a BullMQ job. Plain text column, so
  // adding a value here needs no SQL migration.
  status: text("status", {
    enum: ["pending", "queued", "processing", "annotated", "voiced", "failed"],
  }).notNull().default("queued"),
  attempts: integer("attempts").default(0).notNull(),
  durationMs: integer("duration_ms"),
  isSceneBreak: integer("is_scene_break").notNull().default(0), // 0/1 — scene break before this segment
  sceneSummary: text("scene_summary"), // running summary after this segment was annotated
}, (t) => ({
  unqChapterSegment: unique().on(t.chapterId, t.segmentIndex),
  chapterStatus: index("segments_chapter_id_status_idx").on(t.chapterId, t.status),
  // Status index for the queue-fill scan (WHERE status='queued'). Kept as a
  // plain index: drizzle-kit 0.21 cannot serialize partial-index WHERE
  // clauses and breaks db:push on them.
  statusIdx: index("segments_status_idx").on(t.status),
}));

// 6. Playback State Table
export const playbackState = pgTable("playback_state", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookId: uuid("book_id").references(() => books.id, { onDelete: "cascade" }).notNull(),
  chapterId: uuid("chapter_id").references(() => chapters.id, { onDelete: "cascade" }).notNull(),
  positionMs: integer("position_ms").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  unqBookChapter: unique().on(t.bookId, t.chapterId),
}));

// Relationships definitions for easy Drizzle querying
export const booksRelations = relations(books, ({ many }) => ({
  castMembers: many(castMembers),
  pronunciationDict: many(pronunciationDict),
  chapters: many(chapters),
  playbackStates: many(playbackState),
}));

export const castMembersRelations = relations(castMembers, ({ one, many }) => ({
  book: one(books, { fields: [castMembers.bookId], references: [books.id] }),
  segments: many(segments),
}));

export const pronunciationDictRelations = relations(pronunciationDict, ({ one }) => ({
  book: one(books, { fields: [pronunciationDict.bookId], references: [books.id] }),
}));

export const chaptersRelations = relations(chapters, ({ one, many }) => ({
  book: one(books, { fields: [chapters.bookId], references: [books.id] }),
  segments: many(segments),
  playbackStates: many(playbackState),
}));

export const segmentsRelations = relations(segments, ({ one }) => ({
  chapter: one(chapters, { fields: [segments.chapterId], references: [chapters.id] }),
  speaker: one(castMembers, { fields: [segments.speakerCastId], references: [castMembers.id] }),
}));

export const playbackStateRelations = relations(playbackState, ({ one }) => ({
  book: one(books, { fields: [playbackState.bookId], references: [books.id] }),
  chapter: one(chapters, { fields: [playbackState.chapterId], references: [chapters.id] }),
}));
