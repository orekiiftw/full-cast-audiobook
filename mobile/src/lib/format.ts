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
  if (hours > 0) return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function readTotalSeconds(ms: number | null | undefined): number | null {
  if (ms === null || ms === undefined || ms < 0 || !Number.isFinite(ms)) return null;
  return Math.round(ms / 1000);
}
