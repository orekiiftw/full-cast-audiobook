# The player

`src/components/Player.tsx` is the container for the bottom sheet player: it owns panel
state, wires the hooks, and composes the presentational pieces in `src/components/player/`.
`src/hooks/useAudioPlayer.ts` keeps its original import path and composes the two
element-level hooks that now live beside the player.

## Files

| File                              | Responsibility                                                                    |
| --------------------------------- | --------------------------------------------------------------------------------- |
| `Player.tsx`                      | Container: expansion state, hook wiring, sheet layout, progress bar               |
| `player/playbackMath.ts`          | Pure segment math: next/previous/failed skipping, durations, progress, seek plans |
| `player/audioTiming.ts`           | Pure audio-element helpers: event waits with timeout, seek clamping               |
| `player/useAudioElement.ts`       | Owns the shared element, playback intent, play generation, element listeners      |
| `player/useAudioTransport.ts`     | Play/pause/load/seek/rate commands over a session                                 |
| `player/usePlaybackPosition.ts`   | Position state, whole-second throttle, segment-relative time updates              |
| `player/useSegmentSources.ts`     | Loaded-source bookkeeping, cache-busted reloads, next-line prefetch               |
| `player/useSegmentSync.ts`        | Refresh/polling/SSE wiring, latest-value refs, advancing on fresh data            |
| `player/useSegmentPlayback.ts`    | Segment advance state machine: active line, buffering, navigation, seeking        |
| `player/usePlaybackFollow.ts`     | Element follow: play/pause, ready retry, prefetch trigger                         |
| `player/useLineRegeneration.ts`   | Line regeneration request, modal state, conditional force reload                  |
| `player/PlayerCollapsedBar.tsx`   | Collapsed sheet: titles, transport, elapsed time                                  |
| `player/PlayerExpandedPanel.tsx`  | Expanded sheet: header, transcript, settings, transport                           |
| `player/PlayerHeader.tsx`         | Book/chapter header and collapse control                                          |
| `player/PlaybackSettings.tsx`     | Speed and sleep selects with the remaining-time readout                           |
| `player/RegenerateLineModal.tsx`  | Regeneration modal form                                                           |
| `player/SegmentTranscript.tsx`    | Transcript list, active-row scrolling, per-row redo affordance                    |
| `player/index.ts`                 | Folder surface consumed by `Player.tsx` and `src/hooks/useAudioPlayer.ts`         |

## Audio element invariants

The element is a module singleton (`getSharedAudio`) that outlives the player component,
so every command re-reads it instead of caching a node. Two refs protect the shared
element from stale work: `wantsPlaybackRef` is the only source of intent and is cleared
whenever the browser blocks a play, and `playGenerationRef` invalidates in-flight async
`play` calls as soon as a new source load starts. `canplay`, `canplaythrough` and
`loadeddata` all retry the pending play, because browsers drop `play()` issued while the
source is still loading; `stalled` and `suspend` restart it when playback intent survives.

## Segment source bookkeeping

A loaded source is identified by `` `${segmentId}:${durationMs ?? 0}:${src}` ``. Forced
reloads append `&_=<timestamp>` to the audio URL to defeat the HTTP cache and store that
busted URL in the key, so the following render pass sees a key mismatch and reloads the
plain URL once. The line then restarts from the beginning, which is the intended outcome
for a regenerated line.

## Seek hand-off

A seek that targets a segment which is not loaded yet is stored as a pending value and
consumed by the next `loadAndPlay` call; a seek inside the already loaded segment is
applied immediately. The one exception is a playable trailing segment with no known
duration: the seek plan restarts it rather than jumping inside it, because there is no
timeline to jump into.

## Buffering, polling and SSE

When the next line has not been voiced yet, playback pauses and the player polls
`/api/chapters/:id/segments` every 1200 ms until the line is playable, while SSE
`segment_ready` events patch the list in place. SSE-driven refreshes are throttled to one
per 500 ms, and a further safety net retries `play()` every 800 ms up to five consecutive
failures before dropping the playing flag.

## Sleep timer ownership

The countdown lives in `App` (`useSleepTimer`); the player receives the preset and the
remaining seconds as props and only reports preset changes, so it keeps the timer alive
across chapter switches.

## Why the audio hooks live in `components/player/`

`src/hooks/useAudioPlayer.ts` keeps the long-standing import path consumers use and is now a
thin composition of `useAudioElement` and `useAudioTransport`. Those element-level hooks
live beside the player because nothing else uses them; splitting them further out to
`src/hooks/` would create files that exist for a single consumer.
