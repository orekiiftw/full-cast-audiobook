# The app shell

`src/App.tsx` is the composition root: it owns the auth gate, the authenticated shell
(`AuthenticatedApp`, `AppHeader`) and two shell-local hooks (`useLibraryRoute`,
`useSignOut`). Everything below it is split between shared hooks in `src/hooks/` and
screen folders in `src/components/{library,bookDetail,auth}/`.

## Files

| File | Responsibility |
| --- | --- |
| `src/App.tsx` | Auth gate, authenticated shell, header, library/detail route state, sign-out flow |
| `src/hooks/sessionBootstrap.ts` | The two requests that restore a session: `preloadLibrary` (boot book list), `fetchAuthenticatedUser` |
| `src/hooks/useAuthSession.ts` | Auth status machine, session restore effect, `AUTH_EXPIRED_EVENT` teardown, login/logout |
| `src/hooks/usePlaybackSession.ts` | Active book/chapter/segment state, chapter start and auto-advance |
| `src/hooks/playbackSelection.ts` | Pure: where to start a chapter (`resolveStartSegmentIndex`), which chapter plays next |
| `src/hooks/usePlaybackProgressSync.ts` | `PUT /api/playback` on an interval, plus a save on teardown |
| `src/hooks/useSSE.ts` | EventSource lifecycle, JSON parse, reconnect policy |
| `src/hooks/useSleepTimer.ts` | Sleep preset, countdown, pause-on-expiry |
| `src/components/library/` | Library screen: container pieces, view states, add-book modal and its hooks |
| `src/components/bookDetail/` | Detail screen: hero, console, chapter list, narrator, dictionary, and their hooks |
| `src/components/bookDetail/BookDetailView.tsx` | The loaded-state layout; takes the four screen hooks' models so the container stays guards + wiring |
| `src/components/auth/` | Pre-auth surface: intro panel, form, field, mode tabs, session-restore shells |

## Layering

Hooks in `src/hooks/` never import a component module, so `usePlaybackSession` receives
`showToast` as an argument rather than calling `useToast()` itself. Screen-local hooks
under `src/components/*/` are allowed to consume the toast context directly, because
they already live inside the component layer.

## Session restore

`useAuthSession` starts `preloadLibrary()` and the `/api/auth/me` check in one effect.
`preloadLibrary` returns `null` when no session hint is stored and a promise otherwise;
that promise is handed to `Library` as `bootBooks`, which primes the list from the same
response the app already paid for instead of re-fetching. `AuthenticatedApp` is keyed by
`user.id ?? user.email`, so a different identity remounts the whole shell.

## Playback invariants

`playChapter` guards every state write with a monotonically increasing request id, so a
slow segment fetch for one chapter cannot overwrite a newer one. The progress save runs
before the playback target is replaced — that ordering is what persists the *previous*
chapter's position when the listener switches chapters. `resolveStartSegmentIndex`
trusts the accumulated segment durations to find the resume point, then falls back to the
nearest voiced line, then to the first playable one, because a resume timestamp can point
into a segment that has no audio yet.

## Sleep timer

The deadline is the source of truth; `sleepTimeLeft` is derived from it. Setting the
remaining seconds anchors a deadline, and resuming playback re-anchors the deadline to
the remaining seconds so a pause does not consume sleep time. The countdown itself only
runs while playback is active: a timer set before a long pause used to tick down, expire
mid-pause, and be gone by the time playback resumed.

## SSE reconnect policy

`useSSE` retries with exponential backoff (1s base, 30s cap). A native `EventSource`
sends same-origin cookies automatically but does not expose the HTTP status, so on a
transport error the hook probes `/api/auth/me` before reconnecting: a 401 means the
session is gone and the stream ends instead of retrying forever. The
`AUTH_EXPIRED_EVENT` listener tears the stream down as well. Opening the stream resets
the attempt counter and fires `onReconnect` only when the stream is recovering from a
drop — events emitted during the outage are lost, so SSE-only views like BookDetail
would otherwise stay stale.
