export function audioUrl(key: string): string {
  return `/api/audio?key=${encodeURIComponent(key)}`;
}

export function versionedAudioUrl(key: string, durationMs: number | null | undefined): string {
  return `${audioUrl(key)}&v=${durationMs ?? 0}`;
}
