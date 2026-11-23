import { SseParser, parsePipelineMessage, parseSseBlock, reconnectDelayMs } from "./sse";

describe("SSE frame parsing", () => {
  it("splits frames on a blank line and parses the JSON payload", () => {
    const parser = new SseParser();
    const messages = parser.push('data: {"type":"progress_log","message":"hi"}\n\ndata: {"type":"status_change","status":"ready"}\n\n');

    expect(messages).toHaveLength(2);
    expect(parsePipelineMessage(messages[0])).toEqual({ type: "progress_log", message: "hi" });
    expect(parsePipelineMessage(messages[1])).toEqual({ type: "status_change", status: "ready" });
  });

  it("holds a partial frame until its terminator arrives", () => {
    const parser = new SseParser();

    expect(parser.push('data: {"type":"progress_log","mess')).toHaveLength(0);
    expect(parser.push('age":"split"}')).toHaveLength(0);

    const messages = parser.push("\n\n");
    expect(messages).toHaveLength(1);
    expect(parsePipelineMessage(messages[0])).toEqual({ type: "progress_log", message: "split" });
  });

  it("ignores heartbeat comments and keeps working across CRLF frames", () => {
    const parser = new SseParser();
    const messages = parser.push(': heartbeat\r\n\r\ndata: {"type":"quota_exceeded"}\r\n\r\n');

    expect(messages).toHaveLength(1);
    expect(messages[0].data).toBe('{"type":"quota_exceeded"}');
  });

  it("joins multi-line data fields with newlines", () => {
    const message = parseSseBlock('event: pipeline\ndata: {"type":"chapter_status",\ndata: "chapterId":"c1"}\nid: 7');

    expect(message).not.toBeNull();
    expect(message?.event).toBe("pipeline");
    expect(message?.id).toBe("7");
    expect(message?.data).toBe('{"type":"chapter_status",\n"chapterId":"c1"}');
  });

  it("drops a frame with no data field", () => {
    expect(parseSseBlock("event: ping")).toBeNull();
  });

  it("rejects a payload that is not a pipeline event", () => {
    expect(parsePipelineMessage({ event: null, id: null, data: "not json" })).toBeNull();
    expect(parsePipelineMessage({ event: null, id: null, data: '{"hello":1}' })).toBeNull();
  });

  it("backs off 1s → 30s and stays there", () => {
    expect(reconnectDelayMs(0)).toBe(1000);
    expect(reconnectDelayMs(1)).toBe(2000);
    expect(reconnectDelayMs(3)).toBe(8000);
    expect(reconnectDelayMs(5)).toBe(30_000);
    expect(reconnectDelayMs(20)).toBe(30_000);
  });
});
