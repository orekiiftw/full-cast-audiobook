import { createPipelineHub, type PipelineStreamOptions } from "@/lib/pipelineHub";
import type { PipelineEvent } from "@/api/types";

function makeOpener() {
  const opened: PipelineStreamOptions[] = [];
  const closes: string[] = [];
  const opener = (options: PipelineStreamOptions) => {
    opened.push(options);
    return () => closes.push(options.bookId);
  };
  return { opened, closes, opener };
}

const event = (bookId: string, type: PipelineEvent["type"]): PipelineEvent => ({ bookId, type, timestamp: 1 }) as PipelineEvent;

describe("createPipelineHub", () => {
  it("opens one connection per book no matter how many surfaces subscribe", () => {
    const { opened, opener } = makeOpener();
    const hub = createPipelineHub(opener);

    const stopA = hub.subscribe("book-1", () => undefined);
    const stopB = hub.subscribe("book-1", () => undefined);

    expect(opened).toHaveLength(1);
    expect(hub.connectionCount("book-1")).toBe(1);

    stopA();
    expect(hub.connectionCount("book-1")).toBe(1);
    stopB();
    expect(hub.connectionCount("book-1")).toBe(0);
  });

  it("fans one event out to every subscriber of that book only", () => {
    const { opened, opener } = makeOpener();
    const hub = createPipelineHub(opener);
    const first: string[] = [];
    const second: string[] = [];
    const other: string[] = [];

    hub.subscribe("book-1", (received) => first.push(received.type));
    hub.subscribe("book-1", (received) => second.push(received.type));
    hub.subscribe("book-2", (received) => other.push(received.type));

    opened[0].onEvent?.(event("book-1", "status_change"));
    opened[1].onEvent?.(event("book-2", "segment_ready"));

    expect(first).toEqual(["status_change"]);
    expect(second).toEqual(["status_change"]);
    expect(other).toEqual(["segment_ready"]);
  });

  it("closes the connection when the last subscriber leaves and reopens after", () => {
    const { opened, closes, opener } = makeOpener();
    const hub = createPipelineHub(opener);

    const stop = hub.subscribe("book-1", () => undefined);
    stop();
    expect(closes).toEqual(["book-1"]);

    const stopAgain = hub.subscribe("book-1", () => undefined);
    expect(opened).toHaveLength(2);
    stopAgain();
    expect(closes).toEqual(["book-1", "book-1"]);
  });

  it("delivers a reconnect to every subscriber so each can refetch once", () => {
    const { opened, opener } = makeOpener();
    const hub = createPipelineHub(opener);
    const reconnects: string[] = [];

    hub.subscribe(
      "book-1",
      () => undefined,
      () => reconnects.push("detail"),
    );
    hub.subscribe(
      "book-1",
      () => undefined,
      () => reconnects.push("player"),
    );

    opened[0].onReconnect?.();
    expect(reconnects).toEqual(["detail", "player"]);
  });

  it("survives a subscriber unmounting while an event is being delivered", () => {
    const { opened, opener } = makeOpener();
    const hub = createPipelineHub(opener);
    const seen: string[] = [];
    let stopB: () => void = () => undefined;

    hub.subscribe("book-1", () => {
      seen.push("a");
      stopB();
    });
    stopB = hub.subscribe("book-1", () => seen.push("b"));

    // The dispatch works on a snapshot, so a listener that unmounts mid-event still receives
    // this one (it re-renders nothing) and simply is not in the next.
    expect(() => opened[0].onEvent?.(event("book-1", "progress_log"))).not.toThrow();
    expect(seen).toEqual(["a", "b"]);
    expect(hub.connectionCount("book-1")).toBe(1);
  });

  it("ignores a double release", () => {
    const { closes, opener } = makeOpener();
    const hub = createPipelineHub(opener);
    const stop = hub.subscribe("book-1", () => undefined);
    stop();
    stop();
    expect(closes).toEqual(["book-1"]);
  });

  it("closeAll tears every connection down", () => {
    const { closes, opener } = makeOpener();
    const hub = createPipelineHub(opener);
    hub.subscribe("book-1", () => undefined);
    hub.subscribe("book-2", () => undefined);
    expect(hub.connections()).toEqual(["book-1", "book-2"]);
    hub.closeAll();
    expect(closes.sort()).toEqual(["book-1", "book-2"]);
    expect(hub.connections()).toEqual([]);
  });
});
