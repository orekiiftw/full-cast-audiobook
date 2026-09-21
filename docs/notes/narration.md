# Narration layer notes

Rationale for the decisions that used to live in comments across `src/narration/`. Read this before
changing annotation validation, TTS retry behaviour, or beat assembly.

## Annotation trust boundary

`annotateSegment` sends book-derived text (a hostile EPUB can embed model instructions) to Gemini and
gets JSON back. That is a trust boundary, and it holds because of three things:

- **Normalization caps every field.** `MAX_BEATS` (12), `MAX_BEAT_TEXT_CHARS` (4000),
  `MAX_DELIVERY_FIELD_CHARS` (500), `MAX_SCENE_SUMMARY_CHARS` (2000). A prompt-injected or buggy model
  cannot emit unbounded strings into TTS.
- **Delivery ranges are clamped.** `intensity` is coerced into `0..1` (non-finite numbers fall back to
  `0.3`), `pace` is validated against `slow|normal|fast`, malformed beats are dropped rather than
  repaired.
- **The delivery fields never leave the style prompt.** `style`, `emotion`, `intensity` and `pace`
  reach only the TTS style string. They cannot alter the voiced text or reach another system.

Never feed raw model output into a prompt, tool, or query without that validation. `scene_summary` is
the one field that persists (in the DB) and is re-fed into the next segment's annotation prompt, which
is why it gets the extra sanitization below.

### Injection-marker stripping

`sanitizeSceneSummary` strips control characters and then neutralizes the markers
`ignore previous|system:|assistant:|user:|</?system>` before collapsing whitespace and truncating. The
reason it is applied at all is that the summary is persisted and re-injected into the next segment's
prompt: without this step a hostile book could place durable instructions into its own annotation
context.

Known quirk, kept deliberately: the pattern ends with `\b`, and `system:` ends in a non-word
character, so that alternative only matches when a word character follows the colon (e.g. `system:x`).
`system: you` slips through. Tightening the regex changes behaviour, so it needs its own change and
its own tests rather than a drive-by fix.

### Why the core-alignment check exists

After normalization, `beatsMatchSegment` compares the concatenated beat text against the current
segment after collapsing whitespace and reducing both sides to lowercase letters and digits. An
earlier length-only check let altered characters through, so the pipeline could voice text that did
not match the printed segment. Whitespace, quotes, dashes and mid-word splits are cosmetic and are
ignored on purpose; letter/digit differences are not.

When alignment fails, `annotateSegment` logs a warning and returns the scene summary plus a single
neutral beat carrying the original segment text, so no content is ever lost to a bad model response.
The neutral delivery (`NEUTRAL_BEAT_DELIVERY`: `warm neutral storyteller` / `steady narrative flow` /
`0.3` / `normal`) is also the fallback for missing or malformed delivery fields and for a completely
unparseable payload.

### Annotation timeout

The 120s timeout exists to bound a stalled upstream call so the job fails promptly and BullMQ retries,
instead of parking the worker until stall recovery re-runs a paid Gemini call. It uses an
`AbortController` and not `Promise.race`: only aborting actually cancels the in-flight request, while
racing would leave the paid call running while the segment retries, duplicating spend. The
`GoogleGenAI` client is cached per API key because the client is stateless config and rebuilding it per
segment re-parsed the environment on every call.

## TTS layer

`tts/index.ts` is the public surface (`TTSProvider`, `DeliveryHint`, the three error classes,
`isRetryableError`, `getTTSProvider`, `selectProvider`); everything else is implementation.

- **Provider selection** is `TTS_PROVIDER` (forced) → missing `SARVAM_API_KEY` (MiMo) → Indic language
  detection (Sarvam) → MiMo. Providers are cached: one MiMo instance, one Sarvam instance per BCP-47
  code, so a book does not rebuild its provider per beat.
- **Concurrency** is a single shared semaphore (`rateLimit.ts`) sized by `TTS_MAX_CONCURRENCY`, falling
  back to `PIPELINE.MAX_WORKERS_PER_BOOK`. It exists because every worker of every book funnels through
  the same upstream quota.
- **Rate-limit gate**: on a 429 with a `retry-after` header the retry loop records a process-wide
  cool-down, and every later attempt waits it out before sending. `parseRetryAfterMs` accepts both
  delta-seconds and HTTP dates and floors the result at 250ms so a `retry-after: 0` cannot spin.
- **Retry policy**: `isRetryableError` retries 408/409/425/429, every 5xx, and any non-`TtsApiError`
  (network faults, timeouts). Config and input errors never retry. Delays double from
  `TTS.INITIAL_RETRY_DELAY_MS` up to `TTS.MAX_RETRY_AFTER_MS`; a 429's own `retry-after` wins when it is
  shorter than the cap. An exhausted loop rethrows one error naming the provider prefix and the last
  cause.
- **Pronunciation dictionary**: entries become word-boundary regexes with the special characters
  escaped and `$` doubled in the replacement so hints can contain `$`. Compiled regexes are cached in a
  `WeakMap` keyed by dictionary identity, so an unchanged dictionary is compiled once per process.
- **MiMo responses** are read through `readStreamWithCap` with a 64MB ceiling; a non-JSON body becomes
  `MiMo TTS returned an unreadable response: …` while a JSON body without audio reports the API error
  message when one is present.
- **Sarvam** validates the character cap *after* applying the pronunciation dictionary (hints can
  lengthen text), resolves speakers against `SARVAM_SPEAKERS` with `SARVAM_TS_SPEAKER` and then
  `DEFAULT_SARVAM_TS_SPEAKER` as fallbacks, and clamps the pace into `0.5..2`.

## Beat assembly (voiceSegment)

`mergeBeatsWithPauses` trims edge silence from every beat and splices pauses: `BEAT_GAP_MS` after a
sentence-ending beat, `BEAT_GAP_SOFT_MS` otherwise, plus a `SEGMENT_TAIL_PAUSE_MS` at the end. It only
fires when every beat shares one 16-bit PCM format; otherwise the buffers are returned untouched so the
ffmpeg concat fallback can normalize them. Sentence boundaries are recognised for Latin punctuation and
the danda, with trailing closing quotes/brackets allowed after the period.

When the in-memory concat throws, the fallback writes beat files and a concat manifest into a temp
directory, runs ffmpeg, probes the duration with ffprobe (0ms and a warning when probing fails), and
reads the result back. That path is the only reason the module shells out.

The styled attempt and the neutral retry are intentionally not the same call. The styled attempt sends
the full delivery, adds the sanitized `instruction` (control characters stripped, whitespace collapsed,
capped at 500 chars) and passes both `pace` and `intensity`; the neutral retry sends the neutral style,
omits the instruction entirely and passes only `pace`. Preserve that asymmetry.

## Voice context (voiceContext)

`getBookVoiceContext` caches the narrator voice, base style, pronunciation dictionary and detected
language per book for five minutes, up to 1000 books; the eviction pass drops expired entries first and
then oldest-inserted ones. Language detection samples 30 segments starting at 25% of the book so the
sample reflects the body rather than front matter, title pages, or a table of contents.

`pDict` keeps its abbreviated name because `src/api/routes/segments.ts`, `src/orchestrator/segment.ts`
and `src/api/routes/segments.test.ts` all construct or destructure that field.
