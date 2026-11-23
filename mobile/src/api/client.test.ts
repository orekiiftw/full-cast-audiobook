import { listBooks, searchBooks } from "./books";
import { ApiError, REQUEST_TIMEOUT_MS, SEARCH_TIMEOUT_MESSAGE, SEARCH_TIMEOUT_MS, UNREACHABLE_MESSAGE } from "./client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  jest.useRealTimers();
});

// A fetch stub that behaves like the platform one: it rejects only when the request's signal aborts.
function stallingFetch(): jest.Mock {
  const stub = jest.fn((_url: string, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("Aborted")));
    });
  });
  globalThis.fetch = stub as unknown as typeof fetch;
  return stub;
}

function failingFetch(error: Error): jest.Mock {
  const stub = jest.fn(() => Promise.reject(error));
  globalThis.fetch = stub as unknown as typeof fetch;
  return stub;
}

function jsonFetch(payload: unknown, status = 200): jest.Mock {
  const stub = jest.fn(() => Promise.resolve(new Response(JSON.stringify(payload), { status })));
  globalThis.fetch = stub as unknown as typeof fetch;
  return stub;
}

describe("search error reporting", () => {
  it("reports a search that outlives its own budget as a timeout, not a bad address", async () => {
    jest.useFakeTimers();
    stallingFetch();

    const pending = searchBooks({ title: "shadow slave" });
    const assertion = expect(pending).rejects.toMatchObject({ status: 0, timedOut: true, message: SEARCH_TIMEOUT_MESSAGE });
    await jest.advanceTimersByTimeAsync(SEARCH_TIMEOUT_MS);
    await assertion;

    await expect(pending).rejects.not.toThrow(/API_BASE_URL/);
  });

  it("gives a search a bigger budget than every other call", async () => {
    expect(SEARCH_TIMEOUT_MS).toBeGreaterThan(REQUEST_TIMEOUT_MS);
  });

  it("reports an unreachable host with the configured address", async () => {
    failingFetch(new TypeError("Network request failed"));

    await expect(searchBooks({ title: "shadow slave" })).rejects.toMatchObject({
      status: 0,
      timedOut: false,
      message: UNREACHABLE_MESSAGE,
    });
  });

  it("keeps the address out of a timeout on an ordinary call", async () => {
    jest.useFakeTimers();
    stallingFetch();

    const pending = listBooks();
    const assertion = expect(pending).rejects.toMatchObject({ status: 0, timedOut: true });
    await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await assertion;

    await expect(pending).rejects.not.toThrow(/API_BASE_URL/);
  });

  it("surfaces the server's own message for an HTTP error", async () => {
    jsonFetch({ error: "Too many book searches. Try again later." }, 429);

    const failure = searchBooks({ title: "shadow slave" });

    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({ status: 429, message: "Too many book searches. Try again later." });
  });

  it("carries the partial marker through to the caller", async () => {
    jsonFetch({ results: [], partial: true, pending: ["gutenberg"], providers: ["torrent", "gutenberg"] });

    await expect(searchBooks({ title: "shadow slave" })).resolves.toMatchObject({
      partial: true,
      pending: ["gutenberg"],
    });
  });
});
