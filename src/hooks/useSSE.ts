import { useEffect, useRef, useCallback } from "react";
import { AUTH_EXPIRED_EVENT, apiFetch } from "../lib/api";
import type { PipelineEvent } from "../types/api";

interface UseSSEOptions {
  onEvent: (event: PipelineEvent) => void;
  onError?: (error: Event) => void;
  /**
   * Fired after a reconnect (never on the initial connection). Consumers use
   * it to refetch state: events emitted during the outage gap are lost, and
   * SSE-only views (e.g. BookDetail) would otherwise stay stale indefinitely.
   */
  onReconnect?: () => void;
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

    // Native EventSource sends same-origin cookies automatically.
    const source = new EventSource(url);
    sourceRef.current = source;

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

    source.onerror = (error) => {
      onErrorRef.current?.(error);
      source.close();
      if (sourceRef.current === source) sourceRef.current = null;
      if (stoppedRef.current) return;

      // EventSource does not expose the HTTP status. Probe the auth endpoint
      // before reconnecting so a 401 ends the stream instead of retrying forever.
      void apiFetch("/api/auth/me", { method: "GET" })
        .then((response) => {
          if (stoppedRef.current || response.status === 401) return;
          const retryDelay = Math.min(30000, 1000 * Math.pow(2, retryCountRef.current));
          retryCountRef.current += 1;
          reconnectTimeoutRef.current = window.setTimeout(connect, retryDelay);
        })
        .catch(() => {
          if (stoppedRef.current) return;
          const retryDelay = Math.min(30000, 1000 * Math.pow(2, retryCountRef.current));
          retryCountRef.current += 1;
          reconnectTimeoutRef.current = window.setTimeout(connect, retryDelay);
        });
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
