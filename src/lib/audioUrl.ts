export function audioUrl(key: string): string {
  return `/api/audio?key=${encodeURIComponent(key)}`;
}

export function versionedAudioUrl(key: string, durationMs: number | null | undefined): string {
  return withVersion(audioUrl(key), durationMs);
}

export function withVersion(url: string, durationMs: number | null | undefined): string {
  return `${url}&v=${durationMs ?? 0}`;
}
