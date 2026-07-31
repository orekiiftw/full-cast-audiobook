export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || ms < 0 || !Number.isFinite(ms)) return "--:--";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function formatDurationWithHours(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || ms < 0 || !Number.isFinite(ms)) return "--:--";
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** Cache-bust segment audio URLs so regenerated files aren't stuck in HTTP cache. */
export function segmentAudioSrc(audioUrl: string, durationMs?: number | null): string {
  const version = durationMs != null && durationMs >= 0 ? String(durationMs) : "0";
  if (/[?&]v=/.test(audioUrl)) {
    // Normalize existing v= to the latest known duration
    return audioUrl.replace(/([?&])v=[^&]*/, `$1v=${encodeURIComponent(version)}`);
  }
  const join = audioUrl.includes("?") ? "&" : "?";
  return `${audioUrl}${join}v=${encodeURIComponent(version)}`;
}
