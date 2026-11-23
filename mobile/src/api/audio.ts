import { apiJson, apiUrl } from "./client";
import type { MediaTokensResponse, Segment } from "./types";

// Segment `audioUrl` values point at `/api/audio?key=…`, which the app cannot fetch directly:
// the stream route wants a session cookie a native player will not send. The key is the
// handle; `POST /api/media-tokens` swaps a batch of keys for signed, time-limited URLs.
const AUDIO_PATH = "/api/audio";

const MAX_KEYS_PER_REQUEST = 50;

// Reads the `key` query parameter out of a stream URL. Returns null for anything that is not
// an `/api/audio` link, so a future absolute CDN URL simply plays unsigned.
export function audioKeyFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;

  const queryStart = url.indexOf("?");
  if (queryStart === -1) return null;

  const path = url.slice(0, queryStart);
  if (!path.endsWith(AUDIO_PATH)) return null;

  for (const pair of url.slice(queryStart + 1).split("&")) {
    const separator = pair.indexOf("=");
    if (separator === -1) continue;
    if (pair.slice(0, separator) !== "key") continue;
    const raw = pair.slice(separator + 1);
    if (!raw) return null;
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

export function audioKeysOf(segments: Segment[]): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const segment of segments) {
    const key = audioKeyFromUrl(segment.audioUrl);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

export function chunkKeys(keys: string[], size = MAX_KEYS_PER_REQUEST): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < keys.length; index += size) {
    chunks.push(keys.slice(index, index + size));
  }
  return chunks;
}

// `/api/media-tokens` answers with server-relative paths. The audio player would resolve those
// against the app's own origin, so every signed URL is absolutized against the API base first.
export function resolveAudioUrl(url: string): string {
  return url.startsWith("/") ? apiUrl(url) : url;
}

// Until a segment's URL has been signed it has no playable source; every reader of
// `segment.audioUrl` therefore goes through here rather than trusting the raw value.
export function signedUrlFor(segment: Segment, signed: Record<string, string>): string | null {
  const key = audioKeyFromUrl(segment.audioUrl);
  if (!key) return segment.audioUrl && !segment.audioUrl.startsWith(AUDIO_PATH) ? segment.audioUrl : null;
  const url = signed[key];
  return url ? resolveAudioUrl(url) : null;
}

export async function signAudioKeys(keys: string[]): Promise<Record<string, string>> {
  if (keys.length === 0) return {};

  const batches = chunkKeys(keys);
  const responses = await Promise.all(
    batches.map((batch) => apiJson<MediaTokensResponse>("/api/media-tokens", { method: "POST", body: { keys: batch } })),
  );

  const urls: Record<string, string> = {};
  for (const response of responses) Object.assign(urls, response.urls);
  return urls;
}

// Signs every URL a chapter needs, one batch at a time so a long chapter cannot exceed the
// route's per-request key cap.
export async function signChapterAudio(segments: Segment[]): Promise<Record<string, string>> {
  const keys = audioKeysOf(segments.filter((segment) => segment.status === "voiced"));
  if (keys.length === 0) return {};

  const signed: Record<string, string> = {};
  for (const batch of chunkKeys(keys)) {
    Object.assign(signed, await signAudioKeys(batch));
  }
  return signed;
}

// Cover art rides the same stream route and needs no signature: the server serves it to the
// owning session, and this is the one place the app composes that URL.
export function coverStreamUrl(coverR2Key: string | null | undefined): string | null {
  return coverR2Key ? `${AUDIO_PATH}?key=${encodeURIComponent(coverR2Key)}` : null;
}
