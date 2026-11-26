import type { PipelineEvent } from "@/api/types";

// The book's pipeline stream is a per-book resource, not a per-screen one. Three surfaces want
// it at once (the detail console, the add sheet's staging ladder, the player's live lines) and
// before this hub each opened its own connection against a server that caps a user at 8
// streams — so a listener who opened a staging book and then its detail screen held two, and a
// reconnect refetched twice. The hub keeps exactly one connection per book while at least one
// subscriber is attached, and closes it the moment the last one leaves.

export type PipelineListener = (event: PipelineEvent) => void;
export type ReconnectListener = () => void;

export interface PipelineStreamOptions {
  bookId: string;
  onEvent: PipelineListener;
  onReconnect?: () => void;
}

// Returns the close function for the connection.
export type PipelineOpener = (options: PipelineStreamOptions) => () => void;

interface Entry {
  listeners: Set<PipelineListener>;
  reconnectListeners: Set<ReconnectListener>;
  close: () => void;
}

export interface PipelineHub {
  subscribe(bookId: string, listener: PipelineListener, onReconnect?: ReconnectListener): () => void;
  // How many books currently hold an open connection; `connectionCount(bookId)` for one.
  connectionCount(bookId?: string): number;
  connections(): string[];
  closeAll(): void;
}

export function createPipelineHub(open: PipelineOpener): PipelineHub {
  const entries = new Map<string, Entry>();

  return {
    subscribe(bookId, listener, onReconnect) {
      let entry = entries.get(bookId);
      if (!entry) {
        const listeners = new Set<PipelineListener>();
        const reconnectListeners = new Set<ReconnectListener>();
        const created: Entry = {
          listeners,
          reconnectListeners,
          close: () => undefined,
        };
        entries.set(bookId, created);
        created.close = open({
          bookId,
          onEvent: (event) => {
            // Copy: a listener may unsubscribe (unmount) while an event is being fanned out.
            for (const current of [...listeners]) current(event);
          },
          onReconnect: () => {
            for (const current of [...reconnectListeners]) current();
          },
        });
        entry = created;
      }

      entry.listeners.add(listener);
      if (onReconnect) entry.reconnectListeners.add(onReconnect);

      let released = false;
      return () => {
        if (released) return;
        released = true;
        const current = entries.get(bookId);
        if (!current) return;
        current.listeners.delete(listener);
        if (onReconnect) current.reconnectListeners.delete(onReconnect);
        if (current.listeners.size === 0) {
          entries.delete(bookId);
          current.close();
        }
      };
    },

    connectionCount(bookId) {
      return bookId === undefined ? entries.size : entries.has(bookId) ? 1 : 0;
    },

    connections() {
      return [...entries.keys()];
    },

    closeAll() {
      for (const entry of entries.values()) entry.close();
      entries.clear();
    },
  };
}
