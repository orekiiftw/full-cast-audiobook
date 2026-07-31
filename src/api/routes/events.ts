import { pipelineEvents } from "../../orchestrator";
import { requireUuid } from "../../lib/validators";
import { AuthUser } from "../../auth";
import { ownedBook } from "../ownership";
import { json } from "../response";

const EVENTS_RE = /^\/api\/books\/([a-f0-9-]+)\/events$/i;
const HEARTBEAT_INTERVAL_MS = 15_000;
/** Caps concurrent SSE streams per user to prevent listener/timer exhaustion. */
const MAX_SSE_PER_USER = 8;
const activeSseByUser = new Map<string, number>();

export async function registerEventRoutes(req: Request, path: string, user: AuthUser): Promise<Response | null> {
  const match = path.match(EVENTS_RE);
  if (!match || req.method !== "GET") {
    return null;
  }

  const bookId = requireUuid(match[1], "bookId");
  // Authorize before constructing the stream, registering listeners, or waking workers.
  if (!(await ownedBook(user.id, bookId))) return json({ error: "Book not found" }, 404);

  // Bound concurrent streams per user so a single account can't exhaust
  // EventEmitter listeners / timers by opening unclosed connections.
  const open = activeSseByUser.get(user.id) ?? 0;
  if (open >= MAX_SSE_PER_USER) {
    return json({ error: "Too many live event connections. Close one and try again." }, 429);
  }
  activeSseByUser.set(user.id, open + 1);

  // Idempotent teardown — assigned synchronously by start() below. Bound to
  // BOTH the request abort signal and the stream's cancel() callback so the
  // pipelineEvents listener is always removed exactly once, even if one of
  // the two disconnect hooks is missed by the runtime.
  let cleanup: () => void = () => {};

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const safeEnqueue = (chunk: string): boolean => {
        try {
          controller.enqueue(encoder.encode(chunk));
          return true;
        } catch {
          return false; // controller already closed
        }
      };

      safeEnqueue("retry: 10000\n\n");

      const handler = (event: { bookId?: string }) => {
        if (event.bookId === bookId) {
          safeEnqueue(`data: ${JSON.stringify(event)}\n\n`);
        }
      };

      pipelineEvents.on("progress", handler);

      let cleanedUp = false;
      cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        clearInterval(heartbeat);
        pipelineEvents.off("progress", handler);
        // Release this user's connection slot so a new stream can open.
        const remaining = (activeSseByUser.get(user.id) ?? 1) - 1;
        if (remaining <= 0) activeSseByUser.delete(user.id);
        else activeSseByUser.set(user.id, remaining);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      const heartbeat = setInterval(() => {
        if (!safeEnqueue(": heartbeat\n\n")) {
          cleanup();
        }
      }, HEARTBEAT_INTERVAL_MS);

      // Client disconnected (tab closed, fetch aborted, socket dropped)
      req.signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel() {
      // Stream torn down without the abort signal firing
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
