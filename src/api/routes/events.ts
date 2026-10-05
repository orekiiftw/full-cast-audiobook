import { pipelineEvents } from "../../queue";
import { corsHeaders, json } from "../response";
import { type RouteContext, type RouteTable } from "../route";
import { requireUuid } from "../../lib/validators";
import { ownedBook } from "../../books/ownership";

const HEARTBEAT_INTERVAL_MS = 15_000;

const MAX_SSE_PER_USER = 8;

const activeStreamsByUser = new Map<string, number>();

export const eventRoutes: RouteTable = {
  "GET /api/books/:bookId/events": streamBookEvents,
};

async function streamBookEvents({ req, user, params }: RouteContext): Promise<Response> {
  const bookId = requireUuid(params.bookId, "bookId");
  if (!(await ownedBook(user.id, bookId))) return json({ error: "Book not found" }, 404);

  if (!openStreamSlot(user.id)) {
    return json({ error: "Too many live event connections. Close one and try again." }, 429);
  }

  return new Response(createBookEventStream(req, user.id, bookId), {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Content-Type-Options": "nosniff",
      ...corsHeaders(),
    },
  });
}

function createBookEventStream(req: Request, userId: string, bookId: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let stop: () => void = () => {};

  return new ReadableStream({
    start(controller) {
      stop = startEventPump(req, controller, encoder, userId, bookId);
    },
    cancel() {
      stop();
    },
  });
}

function startEventPump(
  req: Request,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  userId: string,
  bookId: string,
): () => void {
  const send = (chunk: string): boolean => {
    try {
      controller.enqueue(encoder.encode(chunk));
      return true;
    } catch {
      return false;
    }
  };

  const forwardProgress = (event: { bookId?: string }) => {
    if (event.bookId === bookId) {
      send(`data: ${JSON.stringify(event)}\n\n`);
    }
  };

  send("retry: 10000\n\n");
  pipelineEvents.on("progress", forwardProgress);

  let cleanedUp = false;
  let heartbeat: ReturnType<typeof setInterval>;

  const stop = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearInterval(heartbeat);
    pipelineEvents.off("progress", forwardProgress);
    closeStreamSlot(userId);
    try {
      controller.close();
    } catch {}
  };

  heartbeat = setInterval(() => {
    if (!send(": heartbeat\n\n")) {
      stop();
    }
  }, HEARTBEAT_INTERVAL_MS);

  if (req.signal.aborted) stop();
  else req.signal.addEventListener("abort", stop, { once: true });

  return stop;
}

function openStreamSlot(userId: string): boolean {
  const openStreams = activeStreamsByUser.get(userId) ?? 0;
  if (openStreams >= MAX_SSE_PER_USER) return false;
  activeStreamsByUser.set(userId, openStreams + 1);
  return true;
}

function closeStreamSlot(userId: string): void {
  const remaining = (activeStreamsByUser.get(userId) ?? 1) - 1;
  if (remaining <= 0) activeStreamsByUser.delete(userId);
  else activeStreamsByUser.set(userId, remaining);
}
