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
  try {
    audio.volume = 0.001;
    // Only prime when idle / on a data URL — don't interrupt real playback
    const srcAttr = audio.getAttribute("src") ?? "";
    const isRealSrc = !!audio.src && !srcAttr.startsWith("data:") && !audio.src.startsWith("data:");
    if (isRealSrc && !audio.paused) return;

    audio.src = SILENT_WAV;
    await audio.play();
    audio.pause();
    audio.currentTime = 0;
  } catch (err) {
    console.warn("Shared audio unlock failed:", err);
  } finally {
    audio.volume = prevVol > 0 ? prevVol : 1;
    // Drop the silent source so the player can assign the real segment URL
    try {
      audio.removeAttribute("src");
      audio.load();
    } catch {
      // ignore
    }
  }
}
