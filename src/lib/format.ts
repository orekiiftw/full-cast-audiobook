export function formatDuration(ms: number | null | undefined): string {
  const totalSeconds = readTotalSeconds(ms);
  if (totalSeconds === null) return "--:--";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function formatDurationWithHours(ms: number | null | undefined): string {
  const totalSeconds = readTotalSeconds(ms);
  if (totalSeconds === null) return "--:--";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function segmentAudioSrc(audioUrl: string, durationMs?: number | null): string {
  const version = durationMs != null && durationMs >= 0 ? String(durationMs) : "0";
  if (/[?&]v=/.test(audioUrl)) {
    return audioUrl.replace(/([?&])v=[^&]*/, `$1v=${encodeURIComponent(version)}`);
  }
  const join = audioUrl.includes("?") ? "&" : "?";
  return `${audioUrl}${join}v=${encodeURIComponent(version)}`;
}

function readTotalSeconds(ms: number | null | undefined): number | null {
  if (ms === null || ms === undefined || ms < 0 || !Number.isFinite(ms)) return null;
  return Math.round(ms / 1000);
}
