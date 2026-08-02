/** Tiny silent WAV — used only to unlock the shared element under a user gesture. */
const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";

let sharedAudio: HTMLAudioElement | null = null;

/**
 * Single HTMLAudioElement for the whole app.
 * Browsers only sticky-unlock the element that played during the user gesture;
 * creating a fresh Audio() after an async fetch loses autoplay permission.
 */
export function getSharedAudio(): HTMLAudioElement {
  if (!sharedAudio) {
    sharedAudio = new Audio();
    sharedAudio.preload = "auto";
  }
  return sharedAudio;
}

/**
 * Must run synchronously from a click/tap handler (before any long await).
 * Plays silence on the shared element so later play() calls succeed.
 */
export function resetSharedAudio(): void {
  if (!sharedAudio) return;
  sharedAudio.pause();
  sharedAudio.removeAttribute("src");
  sharedAudio.load();
  sharedAudio = null;
}

export async function unlockSharedAudio(): Promise<void> {
  const audio = getSharedAudio();
  const prevVol = audio.volume;
  const prevSrcAttr = audio.getAttribute("src") ?? "";
  const isRealSrc = !!audio.src && !prevSrcAttr.startsWith("data:") && !audio.src.startsWith("data:");
  if (isRealSrc && !audio.paused) return;

  // A paused element holding a real source must be restored if the caller
  // bails before assigning a new source (e.g. a failed chapter fetch): the
  // old finally() unconditionally removed the src, leaving the mounted player
  // with a source-less element — play() refused, the load effect wouldn't
  // reload, and the player was wedged until the user re-clicked a chapter.
  const restoreSrc = isRealSrc ? prevSrcAttr : null;
  const restoreTime = audio.currentTime;

  try {
    audio.volume = 0.001;
    // Only prime when idle / on a data URL — don't interrupt real playback
    audio.src = SILENT_WAV;
    await audio.play();
    audio.pause();
    audio.currentTime = 0;
  } catch (err) {
    console.warn("Shared audio unlock failed:", err);
  } finally {
    audio.volume = prevVol > 0 ? prevVol : 1;
    try {
      if (restoreSrc) {
        // Put the real source back (and its position once metadata loads) so a
        // bailed-out caller leaves playback exactly where it was. When the
        // caller DOES proceed, loadAndPlay assigns the new URL and its own
        // seek wins (this listener fires on the old source's metadata first).
        audio.src = restoreSrc;
        if (restoreTime > 0.05) {
          const t = restoreTime;
          audio.addEventListener(
            "loadedmetadata",
            () => {
              try {
                const dur = audio.duration;
                if (Number.isFinite(dur) && dur > 0 && t < dur) audio.currentTime = t;
              } catch {
                // ignore
              }
            },
            { once: true }
          );
        }
        audio.load();
      } else {
        // Drop the silent source so the player can assign the real segment URL
        audio.removeAttribute("src");
        audio.load();
      }
    } catch {
      // ignore
    }
  }
}
