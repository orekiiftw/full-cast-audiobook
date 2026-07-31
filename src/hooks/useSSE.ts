import { useEffect, useRef, useCallback } from "react";
import { AUTH_EXPIRED_EVENT, apiFetch } from "../lib/api";
import type { PipelineEvent } from "../types/api";

interface UseSSEOptions {
  onEvent: (event: PipelineEvent) => void;
  onError?: (error: Event) => void;
}

export function useSSE(url: string, { onEvent, onError }: UseSSEOptions) {
  const sourceRef = useRef<EventSource | null>(null);
  const retryCountRef = useRef(0);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const stoppedRef = useRef(false);
  const onEventRef = useRef(onEvent);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onEventRef.current = onEvent;
    onErrorRef.current = onError;
  }, [onEvent, onError]);

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
      retryCountRef.current = 0;
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
