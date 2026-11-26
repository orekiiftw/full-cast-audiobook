import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { TorrentCandidate } from "../../torrent/types";

const BOOK_ID = "00000000-0000-0000-0000-000000000173";

const TORBOX_AUTH_ERROR =
  "All 2 torrent candidate(s) failed to download: Shadow Slave epub: TorBox failed to add torrent: An error occurred while verifying your token.";

const catalogue: TorrentCandidate[] = [candidate("a"), candidate("b")];
const libraryEpubs: Array<Buffer | null> = [];
const events: Array<Record<string, unknown>> = [];

mock.module("../../torrent", () => ({
  resolveTorrentCandidates: async () => [],
  downloadBookFromCandidates: async () => {
    throw new Error(TORBOX_AUTH_ERROR);
  },
  downloadBookFromTorrent: async () => {
    throw new Error(
      "All 1 torrent candidate(s) failed to download: bad magnet: TorBox failed to add torrent: An error occurred while verifying your token.",
    );
  },
}));
mock.module("../../acquisition/catalogue", () => ({ searchCatalogueTorrentCandidates: async () => catalogue }));
mock.module("../../acquisition", () => ({
  UnsupportedFormatError: class UnsupportedFormatError extends Error {},
  bookProviders: { get: () => ({ acquire: async () => ({}) }) },
  enabledLibrarySources: () => [
    {
      provider: "archive-org",
      label: "Internet Archive / Open Library",
      fetchEpub: async () => (libraryEpubs.length > 0 ? { buffer: libraryEpubs.shift()!, filename: "book.epub" } : null),
    },
  ],
}));
mock.module("../../storage/r2", () => ({ downloadFile: async () => Buffer.alloc(0), deleteFile: async () => {} }));
mock.module("../../queue", () => ({
  emitProgressEvent: (bookId: string, type: string, payload: Record<string, unknown>) => events.push({ bookId, type, payload }),
}));
mock.module("../../db", () => ({ db: {} }));

const { resolveEpubBuffer } = await import("./acquisition");
const { describeIngestionFailure } = await import("./failure");

beforeEach(() => {
  libraryEpubs.length = 0;
  events.length = 0;
});

function candidate(name: string): TorrentCandidate {
  return {
    magnet: `magnet:?xt=urn:btih:${name.repeat(40)}`,
    hash: name.repeat(40),
    name,
    size: 2_000_000,
    seeds: 4,
    source: "apibay",
    cached: true,
    alive: null,
  };
}

async function acquisitionFailure(source: Parameters<typeof resolveEpubBuffer>[2]): Promise<Error> {
  try {
    await resolveEpubBuffer(BOOK_ID, null, source);
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected the acquisition to fail");
}

describe("resolveEpubBuffer when no source hands back a book", () => {
  it("reports the torrent failure and the empty fallback instead of a generic download error", async () => {
    const error = await acquisitionFailure({ torrentQuery: { title: "Shadow Slave", author: "Guiltythree" } });

    expect(error.message).toContain("No source produced a readable EPUB.");
    expect(error.message).toContain("TorBox failed to add torrent");
    expect(error.message).toContain("open libraries (Internet Archive / Open Library): no readable EPUB");

    const reason = describeIngestionFailure(error);
    expect(reason.code).toBe("torbox-auth");
    expect(reason.message).toContain("Your TorBox key was rejected");
    expect(reason.message).toContain("not a readable EPUB");
  });

  it("records a magnet attempt's failure when the request carried a magnet", async () => {
    const error = await acquisitionFailure({ magnetOrHash: `magnet:?xt=urn:btih:${"c".repeat(40)}` });

    expect(error.message).toContain("magnet: All 1 torrent candidate(s) failed to download");
  });

  it("takes a readable library EPUB without reporting a failure", async () => {
    libraryEpubs.push(Buffer.from("epub bytes"));

    expect(await resolveEpubBuffer(BOOK_ID, null, { torrentQuery: { title: "Shadow Slave", author: "Guiltythree" } })).toEqual(
      Buffer.from("epub bytes"),
    );
  });

  it("still says what is missing when the request carries no source at all", async () => {
    expect((await acquisitionFailure({})).message).toBe("No magnet, hash, or title query provided for ingestion.");
  });
});
