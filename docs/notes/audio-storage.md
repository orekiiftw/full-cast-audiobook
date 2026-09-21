# The audio and storage layers

`src/audio/` turns TTS output into chapter MP3s; `src/storage/` is the object store the
rest of the pipeline uploads to and streams from. Both folders keep their original
import paths (`../audio/wav`, `../audio/stitch`, `../storage/r2`, `../storage/keys`)
so consumers did not move.

## Files

| File               | Responsibility                                                                    |
| ------------------ | --------------------------------------------------------------------------------- |
| `audio/wav.ts`     | In-memory WAV work: RIFF parsing, PCM encoding, concat, silence trim and generation |
| `audio/ffmpeg.ts`  | ffmpeg/ffprobe process handling, command timeouts, concat-list path escaping        |
| `audio/stitch.ts`  | Chapter stitching: gap files, segment downloads, concat list, encode, upload        |
| `storage/r2/`      | `index.ts` public surface, `s3.ts` R2 calls, `local.ts` filesystem fallback, `types.ts`, `errors.ts` |
| `storage/keys.ts`  | `isSafeStorageKey` predicate and the throwing `assertSafeKey` guard                 |

## WAV invariants

`parseWav` walks chunks from offset 12, requires `fmt ` (at least 16 bytes) and at least
one `data` chunk, and skips unknown chunks plus the word-alignment pad byte after odd
chunk sizes. It does not trust the RIFF size field: a chunk whose declared size runs past
the buffer raises `Truncated WAV chunk ...`, which is what catches headers written before
truncation.

`trimWavSilence` only understands PCM 16-bit input; anything else, an all-silent buffer,
or a buffer whose edges are already tight is returned unchanged. Audibility is measured
in 10 ms windows, comparing each window's peak sample against 0.015 of full scale, and
the kept region extends `keepMs` (default 40) past the first and last audible window.

## Local storage layout

Without R2 configuration, keys map to `./.storage/` under the process working directory,
relative to whatever cwd is live at module load. A key's URL-encoded form is the file
name; keys whose encoded form exceeds 200 characters are sharded as
`<sha256[0..2]>/<sha256[2..4]>/<sha256>_<last 100 encoded chars>`, a stable mapping for
the same key. Uploads write `<path>.tmp-<pid>-<random>` and rename, so readers never see a
partial file. Two guards reject bad keys: `assertSafeKey` raises `Invalid storage key` for
anything `isSafeStorageKey` refuses, and `localPathForKey` additionally raises
`Path escape blocked for key` if the resolved path leaves the storage root.

## Ranged streaming

`resolveRange` accepts a single `bytes=start-end` / `bytes=start-` / `bytes=-suffix`
header and returns `null` for malformed or unsatisfiable ranges, which the route layer
turns into a 416. Suffix lengths past the object size clamp to 0. `streamFile` reports
`partial: true` only when a range was requested and fewer bytes than the object holds are
served. A `knownSize` hint avoids a second stat/HEAD. Downloads are capped at 512 MB,
checked from ContentLength/stat before streaming, from the running byte count while
streaming, and from `readStreamWithCap` for buffered reads.

## S3 body adaptation and concat

AWS SDK v3 bodies expose `transformToWebStream`; older node-style bodies (anything with
`pipe`) are bridged manually, pausing the source when the web stream's queue fills and
resuming on `pull`, with `destroy` on cancel. ffmpeg concat lists hold single-quoted
relative file names resolved against the process cwd; `escapeFfmpegConcatPath` refuses
newlines and backslashes and escapes `'` as `'\''`.

## Invariants worth knowing

- `statFile`/`streamFile` on a missing **local** key surface the raw fs error; only
  `downloadFile` maps it to `File not found`. Changing that would change API responses.
- `streamFile` on a zero-byte local object throws a node range error (`end` of -1).
- Stitching keeps a whole chapter under `stitch_*` in the OS temp dir and removes the
  directory in `finally`; the ffmpeg timeout scales with downloaded bytes at 48 kB/s,
  floored at 5 minutes and capped at 1 hour.
- Both storage backends are chosen once per call from env presence (`R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET` all set means S3); a missing
  configuration logs the local-fallback warning at module load.
