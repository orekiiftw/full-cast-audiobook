const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";

let sharedAudio: HTMLAudioElement | null = null;

export function getSharedAudio(): HTMLAudioElement {
  if (!sharedAudio) {
    sharedAudio = new Audio();
    sharedAudio.preload = "auto";
  }
  return sharedAudio;
}

export function resetSharedAudio(): void {
  if (!sharedAudio) return;
  sharedAudio.pause();
  sharedAudio.removeAttribute("src");
  sharedAudio.load();
  sharedAudio = null;
}

export async function unlockSharedAudio(): Promise<void> {
  const audio = getSharedAudio();
  const previousVolume = audio.volume;
  const resumableSrc = resumableSource(audio);
  if (resumableSrc && !audio.paused) return;

  const resumableTime = audio.currentTime;

  try {
    await playSilentPrimer(audio);
  } catch (err) {
    console.warn("Shared audio unlock failed:", err);
  } finally {
    audio.volume = previousVolume > 0 ? previousVolume : 1;
    restoreSource(audio, resumableSrc, resumableTime);
  }
}

function resumableSource(audio: HTMLAudioElement): string | null {
  const srcAttribute = audio.getAttribute("src") ?? "";
  const hasRealSrc = !!audio.src && !srcAttribute.startsWith("data:") && !audio.src.startsWith("data:");
  return hasRealSrc ? srcAttribute : null;
}

async function playSilentPrimer(audio: HTMLAudioElement): Promise<void> {
  audio.volume = 0.001;
  audio.src = SILENT_WAV;
  await audio.play();
  audio.pause();
  audio.currentTime = 0;
}

function restoreSource(audio: HTMLAudioElement, resumableSrc: string | null, resumableTime: number): void {
  try {
    if (!resumableSrc) {
      audio.removeAttribute("src");
      audio.load();
      return;
    }

    audio.src = resumableSrc;
    if (resumableTime > 0.05) {
      audio.addEventListener(
        "loadedmetadata",
        () => {
          try {
            const duration = audio.duration;
            if (Number.isFinite(duration) && duration > 0 && resumableTime < duration) audio.currentTime = resumableTime;
          } catch {}
        },
        { once: true },
      );
    }
    audio.load();
  } catch {}
}
