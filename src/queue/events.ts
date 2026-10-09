import { EventEmitter } from "events";
import { QUEUE } from "../lib/constants";
import { invalidateBookVoiceContext } from "../narration/voiceContext";
import { redis, redisSub } from "./connection";

interface BookEvent {
  bookId: string;
  type: string;
  status?: string;
  message?: string;
}

export const pipelineEvents = new EventEmitter();

pipelineEvents.setMaxListeners(500);

const discoveryStageByBook = new Map<string, string[]>();

pipelineEvents.on("progress", trackDiscoveryStage);

export function discoveryStageMessages(bookId: string): string[] {
  return discoveryStageByBook.get(bookId) ?? [];
}

export function emitProgressEvent(bookId: string, eventType: string, payload: Record<string, unknown>): void {
  const event = { bookId, type: eventType, ...payload, timestamp: Date.now() };
  redis.publish(QUEUE.EVENTS_CHANNEL, JSON.stringify(event)).catch((err) => {
    console.warn("⚠️ Failed to publish pipeline event:", err.message);
  });
}

export function invalidateBookVoiceContextClusterwide(bookId: string): void {
  invalidateBookVoiceContext(bookId);
  redis.publish(QUEUE.VOICE_INVALIDATE_CHANNEL, bookId).catch((err) => {
    console.warn("⚠️ Failed to publish voice-context invalidation:", err.message);
  });
}

export async function initEventBridge(): Promise<void> {
  redisSub.on("message", (channel: string, message: string) => {
    if (channel === QUEUE.VOICE_INVALIDATE_CHANNEL) {
      invalidateBookVoiceContext(message);
      return;
    }
    try {
      pipelineEvents.emit("progress", JSON.parse(message));
    } catch {}
  });
  await redisSub.subscribe(QUEUE.EVENTS_CHANNEL, QUEUE.VOICE_INVALIDATE_CHANNEL);
}

function trackDiscoveryStage({ bookId, type, status, message }: BookEvent): void {
  if (type === "status_change") {
    if (status === "discovering" && message) discoveryStageByBook.set(bookId, [message]);
    else discoveryStageByBook.delete(bookId);
    return;
  }
  const stage = discoveryStageByBook.get(bookId);
  if (type === "progress_log" && stage && message) discoveryStageByBook.set(bookId, [stage[0], message]);
}
