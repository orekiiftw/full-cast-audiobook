import { useEffect, useRef, useCallback } from "react";
import { AUTH_EXPIRED_EVENT, apiFetch } from "../lib/api";
import type { PipelineEvent } from "../types/api";

interface UseSSEOptions {
  onEvent: (event: PipelineEvent) => void;
  onError?: (error: Event) => void;
  onReconnect?: () => void;
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

function reconnectDelayMs(attempt: number): number {
  return Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt);
}

async function sessionSurvivedInterrupt(): Promise<boolean> {
  try {
    const response = await apiFetch("/api/auth/me", { method: "GET" });
    return response.status !== 401;
  } catch {
    return true;
  }
}

export function useSSE(url: string, { onEvent, onError, onReconnect }: UseSSEOptions) {
  const sourceRef = useRef<EventSource | null>(null);
  const retryCountRef = useRef(0);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const stoppedRef = useRef(false);
  const onEventRef = useRef(onEvent);
  const onErrorRef = useRef(onError);
  const onReconnectRef = useRef(onReconnect);

  useEffect(() => {
    onEventRef.current = onEvent;
    onErrorRef.current = onError;
    onReconnectRef.current = onReconnect;
  }, [onEvent, onError, onReconnect]);

  const clearReconnect = useCallback(() => {
    if (reconnectTimeoutRef.current !== null) {
      window.clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    clearReconnect();
    sourceRef.current?.close();
    sourceRef.current = null;
  }, [clearReconnect]);

  const connect = useCallback(() => {
    if (stoppedRef.current) return;
    sourceRef.current?.close();

    const source = new EventSource(url);
    sourceRef.current = source;

    const scheduleReconnect = () => {
      if (stoppedRef.current) return;
      const retryDelay = reconnectDelayMs(retryCountRef.current);
      retryCountRef.current += 1;
      reconnectTimeoutRef.current = window.setTimeout(connect, retryDelay);
    };

    source.onopen = () => {
      const wasReconnect = retryCountRef.current > 0;
      retryCountRef.current = 0;
      if (wasReconnect) onReconnectRef.current?.();
    };

    source.onmessage = (message) => {
      try {
        const payload = JSON.parse(message.data) as PipelineEvent;
        onEventRef.current(payload);
      } catch (error) {
        console.warn("Failed to parse SSE payload:", error);
      }
    };

    const handleInterrupt = async () => {
      if (await sessionSurvivedInterrupt()) scheduleReconnect();
    };

    source.onerror = (error) => {
      onErrorRef.current?.(error);
      source.close();
      if (sourceRef.current === source) sourceRef.current = null;
      if (stoppedRef.current) return;

      void handleInterrupt();
    };
  }, [url]);

  useEffect(() => {
    stoppedRef.current = false;
    const handleAuthExpired = () => stop();
    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    connect();
    return () => {
      window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
      stop();
    };
  }, [connect, stop]);
}
