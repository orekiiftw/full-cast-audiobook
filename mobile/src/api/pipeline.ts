import { getBearerToken } from "./client";
import { openPipelineStream } from "./sse";
import { createPipelineHub } from "@/lib/pipelineHub";

// The app's single owner of pipeline connections. Every surface that wants a book's events
// subscribes here; the hub keeps one SSE stream per book alive while it has subscribers, which
// matters on a server that caps a user at eight concurrent streams.
export const bookPipeline = createPipelineHub(({ bookId, onEvent, onReconnect }) =>
  openPipelineStream({
    bookId,
    token: getBearerToken(),
    onEvent,
    onReconnect,
  }),
);
