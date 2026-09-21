import { EventEmitter } from "events";
import { QUEUE } from "../lib/constants";
import { invalidateBookVoiceContext } from "../narration/voiceContext";
import { redis, redisSub } from "./connection";

export const pipelineEvents = new EventEmitter();
pipelineEvents.setMaxListeners(500);

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
