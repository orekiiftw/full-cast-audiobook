import {
  clearAllPreloadedSources,
  clearPreloadedSource,
  createAudioPlayer,
  preload,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioStatus,
} from "expo-audio";

// Thin imperative wrapper over one expo-audio player. The player is a singleton for the app's
// lifetime (the provider that owns session state lives in the root layout), so a navigation
// away from the player screen never stops the audio.
//
// expo-audio's `play()` does not wait for a source to load, so desired playback is held here
// and re-applied from status updates once `isLoaded` flips — the native equivalent of the web
// client's "wait for canplay, then play".

export interface LoadOptions {
  seekSec?: number | null;
  autoplay: boolean;
}

export interface TransportCallbacks {
  onProgress: (currentTimeSec: number, isLoaded: boolean) => void;
  onFinished: () => void;
}

let player: AudioPlayer | null = null;
let audioModeConfigured = false;

function ensurePlayer(): AudioPlayer {
  if (!player) {
    player = createAudioPlayer(null, { updateInterval: 400 });
  }
  return player;
}

export async function configureAudioMode(): Promise<void> {
  if (audioModeConfigured) return;
  audioModeConfigured = true;
  try {
    await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false, interruptionMode: "doNotMix" });
  } catch (error) {
    console.warn("Could not configure the audio session:", error);
  }
}

export interface AudioTransport {
  load: (url: string, options: LoadOptions) => void;
  play: () => void;
  pause: () => void;
  seekTo: (seconds: number) => void;
  setRate: (rate: number) => void;
  // Holds at most one line ready. Passing a different URL releases the previous preload first,
  // so a chapter that advances releases the line it played instead of hoarding buffers.
  prefetch: (url: string | null) => void;
  releaseSources: () => void;
  currentTime: () => number;
  isPlaying: () => boolean;
  subscribe: (callbacks: TransportCallbacks) => () => void;
}

export function createTransport(): AudioTransport {
  let desiredPlaying = false;
  let pendingSeekSec: number | null = null;
  let finishedTrack = "";
  let currentUrl: string | null = null;
  // `play()` is applied once per load, not on every status tick: a status callback that calls
  // back into play() can spin on platforms whose player emits synchronously.
  let playRequested = false;

  const listeners = new Set<TransportCallbacks>();
  let statusSubscription: { remove: () => void } | null = null;

  // The one URL currently held for the next line, so a repeat call is a no-op and a move
  // releases the old buffer.
  let prefetchedUrl: string | null = null;

  const releasePrefetch = () => {
    if (prefetchedUrl === null) return;
    const stale = prefetchedUrl;
    prefetchedUrl = null;
    try {
      void Promise.resolve(clearPreloadedSource(stale)).catch(() => undefined);
    } catch {
      // Releasing is best-effort: a platform without a preload cache simply has nothing to free.
    }
  };

  const handleStatus = (status: AudioStatus) => {
    const instance = ensurePlayer();

    for (const listener of listeners) listener.onProgress(status.currentTime ?? 0, !!status.isLoaded);

    if (status.isLoaded && pendingSeekSec !== null) {
      const target = pendingSeekSec;
      pendingSeekSec = null;
      void instance.seekTo(target);
    }

    if (status.isLoaded && desiredPlaying && !playRequested && !status.didJustFinish) {
      playRequested = true;
      instance.play();
    }

    if (!status.isLoaded) playRequested = false;

    if (status.didJustFinish && currentUrl && finishedTrack !== currentUrl) {
      finishedTrack = currentUrl;
      playRequested = false;
      for (const listener of listeners) listener.onFinished();
    }
  };

  const subscribe = (callbacks: TransportCallbacks): (() => void) => {
    const instance = ensurePlayer();
    listeners.add(callbacks);
    if (!statusSubscription) {
      statusSubscription = instance.addListener("playbackStatusUpdate", handleStatus);
    }
    return () => {
      listeners.delete(callbacks);
    };
  };

  return {
    load(url, { seekSec, autoplay }) {
      const instance = ensurePlayer();
      desiredPlaying = autoplay;
      finishedTrack = "";
      playRequested = false;
      pendingSeekSec = seekSec != null && seekSec > 0.05 ? seekSec : null;
      if (currentUrl === url && instance.isLoaded) {
        if (pendingSeekSec !== null) {
          void instance.seekTo(pendingSeekSec);
          pendingSeekSec = null;
        }
        if (autoplay) instance.play();
        return;
      }
      currentUrl = url;
      instance.replace({ uri: url });
      if (autoplay) instance.play();
    },
    play() {
      desiredPlaying = true;
      playRequested = true;
      ensurePlayer().play();
    },
    pause() {
      desiredPlaying = false;
      ensurePlayer().pause();
    },
    seekTo(seconds) {
      const instance = ensurePlayer();
      if (!Number.isFinite(seconds)) return;
      void instance.seekTo(Math.max(0, seconds));
    },
    setRate(rate) {
      // Android's player accepts 0.1–2.0; the settings sheet only offers speeds in that band.
      ensurePlayer().setPlaybackRate(rate, "medium");
    },
    prefetch(url) {
      if (url === prefetchedUrl) return;
      releasePrefetch();
      if (!url) return;
      prefetchedUrl = url;
      try {
        // Web's preload resolves synchronously with nothing, so it cannot be chained on.
        const pending = preload(url) as Promise<unknown> | undefined;
        if (pending && typeof pending.catch === "function") {
          void pending.catch(() => undefined);
        }
      } catch {
        // Preloading is an optimisation: a failure just means the next line starts un-buffered.
      }
    },
    releaseSources() {
      prefetchedUrl = null;
      try {
        void Promise.resolve(clearAllPreloadedSources()).catch(() => undefined);
      } catch {
        // Nothing held, nothing to release.
      }
    },
    currentTime() {
      return player?.currentTime ?? 0;
    },
    isPlaying() {
      return !!player?.playing;
    },
    subscribe,
  };
}
