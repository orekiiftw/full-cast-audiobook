import { fetch as expoFetch } from "expo/fetch";
import { API_BASE_URL } from "./config";
import type { PipelineEvent } from "./types";

// `GET /api/books/:id/events` is a plain `text/event-stream` of PipelineEvents: one
// `data: <json>` frame per event, `: heartbeat` comments for liveness. Expo's fetch is
// WinterCG-compliant and streams response bodies on both native and web, so the SSE reader
// here is a small pure parser over chunks rather than a native EventSource dependency —
// it keeps header auth (`Authorization: Bearer`) and it is testable without a device.
export interface SseMessage {
  event: string | null;
  data: string;
  id: string | null;
}

// Frames are separated by a blank line; a frame that has not yet arrived stays buffered.
export class SseParser {
  private buffer = "";

  push(chunk: string): SseMessage[] {
    this.buffer += chunk.replace(/\r\n?/g, "\n");
    const messages: SseMessage[] = [];

    let boundary = this.buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const block = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      const message = parseSseBlock(block);
      if (message) messages.push(message);
      boundary = this.buffer.indexOf("\n\n");
    }
    return messages;
  }

  reset(): void {
    this.buffer = "";
  }
}

export function parseSseBlock(block: string): SseMessage | null {
  const dataLines: string[] = [];
  let event: string | null = null;
  let id: string | null = null;

  for (const line of block.split("\n")) {
    if (line === "" || line.startsWith(":")) continue;

    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? "" : line.slice(separator + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "data") dataLines.push(value);
    else if (field === "event") event = value;
    else if (field === "id") id = value;
  }

  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n"), id };
}

export function parsePipelineMessage(message: SseMessage): PipelineEvent | null {
  try {
    const payload = JSON.parse(message.data) as PipelineEvent;
    return payload && typeof payload === "object" && typeof payload.type === "string" ? payload : null;
  } catch {
    return null;
  }
}

export const SSE_RECONNECT_BASE_MS = 1000;
export const SSE_RECONNECT_MAX_MS = 30_000;

// 1s, 2s, 4s … capped at 30s — the same ramp the web client's EventSource wrapper uses.
export function reconnectDelayMs(attempt: number): number {
  return Math.min(SSE_RECONNECT_MAX_MS, SSE_RECONNECT_BASE_MS * 2 ** Math.max(0, attempt));
}

export interface PipelineStreamHandlers {
  onEvent: (event: PipelineEvent) => void;
  // Called when a connection re-establishes after at least one failure, so the caller can
  // refetch the detail payload and catch up on whatever was missed while disconnected.
  onReconnect?: () => void;
  onError?: (error: unknown) => void;
  token: string | null;
  bookId: string;
  baseUrl?: string;
}

export function pipelineEventsUrl(bookId: string, baseUrl: string = API_BASE_URL): string {
  return `${baseUrl}/api/books/${encodeURIComponent(bookId)}/events`;
}

export function openPipelineStream({
  onEvent,
  onReconnect,
  onError,
  token,
  bookId,
  baseUrl = API_BASE_URL,
}: PipelineStreamHandlers): () => void {
  let closed = false;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let abortController: AbortController | null = null;

  const scheduleReconnect = () => {
    if (closed) return;
    const delay = reconnectDelayMs(attempt);
    attempt += 1;
    reconnectTimer = setTimeout(() => void connect(), delay);
  };

  const connect = async (): Promise<void> => {
    if (closed) return;

    const controller = new AbortController();
    abortController = controller;
    const parser = new SseParser();
    let sawOpen = false;

    try {
      const response = await expoFetch(pipelineEventsUrl(bookId, baseUrl), {
        headers: {
          Accept: "text/event-stream",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: controller.signal,
      });

      if (response.status === 401) {
        // The session is gone; the app's 401 handling sends the user back to Auth.
        closed = true;
        return;
      }
      if (!response.ok || !response.body) throw new Error(`Event stream failed with ${response.status}`);

      sawOpen = true;
      const wasReconnect = attempt > 0;
      attempt = 0;
      if (wasReconnect) onReconnect?.();

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      for (;;) {
        const { done, value } = await reader.read();
        if (done || closed) break;
        const text = decoder.decode(value, { stream: true });
        for (const message of parser.push(text)) {
          const event = parsePipelineMessage(message);
          if (event) onEvent(event);
        }
      }

      if (!closed) scheduleReconnect();
    } catch (error) {
      if (closed) return;
      onError?.(error);
      if (!sawOpen) attempt = Math.max(0, attempt);
      scheduleReconnect();
    } finally {
      if (abortController === controller) abortController = null;
    }
  };

  void connect();

  return () => {
    closed = true;
    if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    abortController?.abort();
  };
}
