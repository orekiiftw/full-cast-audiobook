# Narratea mobile

The native client for Narratea: an Expo (SDK 58, `expo-router`, TypeScript) app that signs in
against the API's native session, lists your library, shows a book's chapters with live
voicing progress, and plays chapters line by line with a follow-along transcript.

It is its own package with its own `bun.lock`. Nothing here is shared with the Vite web client
in `src/`: the web client is the behavioural and visual reference, not a dependency.

## Run it

```bash
cd mobile
bun install
npx expo start
```

The app talks to the API at `EXPO_PUBLIC_API_BASE_URL` (default `http://localhost:3000`):

| Where you run the app | Value |
| --- | --- |
| iOS Simulator / Android emulator | `http://localhost:3000` (default, nothing to set) |
| Web export / Expo web | `http://localhost:3000` |
| A real phone on the same Wi-Fi | `http://<your-machine-LAN-IP>:3000`, e.g. `http://192.168.1.20:3000` |

A phone's `localhost` is the phone itself, so a physical device needs the LAN address. Find it
with `ipconfig getifaddr en0` (macOS) or `hostname -I` (Linux), make sure the API listens on
`0.0.0.0:3000`, then start the app with the value in the environment:

```bash
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.20:3000 npx expo start
```

`EXPO_PUBLIC_*` values are inlined at bundle time, so restart `expo start` after changing one.

### Expo Go or a dev build

Everything the app uses (`expo-audio`, `expo-secure-store`, `expo-font`, `expo-router`) is part
of Expo Go for this SDK, so **Expo Go is enough** — scan the QR code from `expo start`. A
development build (`npx expo run:ios` / `npx expo run:android`, or `eas build --profile
development`) is only needed if a future feature adds native code Expo Go does not ship, such
as background playback or a lock-screen widget.

Web is a build proof, not a target: session storage falls back to `localStorage` and cover
images rely on native image headers, so treat the web export as a pixel/layout check.

## How live updates reach the app

**`expo/fetch` streaming, not `react-native-sse`.** Expo's fetch is WinterCG-compliant and
streams response bodies on native and web, so `GET /api/books/:id/events` is read with a
`ReadableStream` reader plus a small in-repo frame parser (`src/api/sse.ts`). That keeps the
`Authorization: Bearer` header (no query-token juggling), adds no native dependency, and makes
the parser — frame splitting, multi-line `data:`, heartbeat comments, reconnect backoff — a
pure function the Jest suite covers without a device. Reconnects ramp 1s → 30s and trigger a
detail refetch so events missed while disconnected are reconciled.

## Checks

```bash
npx tsc --noEmit                     # types
npx jest                             # pure-logic unit tests (segment advance, position math,
                                     # sleep timer, SSE frames, media-token keys)
npx expo export --platform web       # bundle proof, writes mobile/dist
```

CI runs the first two in its own `mobile` job with `bun install --frozen-lockfile`.

## Layout

```
src/app/            expo-router routes: index (library), auth, book/[id], player (modal)
src/auth/           AuthProvider — bootstraps the stored token, clears on any 401
src/api/            types, fetch client, auth, books, audio signing, SSE parser/stream
src/playback/       player session provider, expo-audio transport, ported playback math,
                    segment/chapter selection, sleep timer, detail event reducer
src/components/     ui primitives and the library / book detail / player screens
src/theme/          the Listening Room tokens ported from tailwind.config.js
```

The player keeps its state in a provider mounted in the root layout, so audio keeps playing
while the player modal is closed and the dock on the library and detail screens takes over.
Position is written with `PUT /api/playback` every ~10s and on pause, and resumes from
`playbackState` when a chapter is opened.

## Not built yet

- **Offline downloads.** Playback streams only; no chapter cache on device.
- **Background playback / lock-screen controls.** `enableBackgroundPlayback` is off in
  `app.json` and the audio session is foreground-only.
- **EPUB upload and magnet links.** Add-a-book is search → pick → submit; the web client's
  upload and magnet flows need a file picker and content-URI work that was out of scope.
- **Pronunciation editor, narrator preview, per-line redo.** Read-only detail screen for v1.
- **Cover art on web.** Covers stream from the authenticated `/api/audio` route with a bearer
  header, which native `Image` supports; the web export falls back to the typographic plate.
