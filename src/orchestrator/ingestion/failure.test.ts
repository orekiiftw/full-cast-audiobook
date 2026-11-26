import { beforeEach, describe, expect, it, mock } from "bun:test";

const BOOK_ID = "00000000-0000-0000-0000-000000000173";

const updates: Array<Record<string, unknown>> = [];
const events: Array<{ bookId: string; type: string; payload: Record<string, unknown> }> = [];
let bookDeleted = false;

function updateChain(): Promise<unknown[]> & { returning: () => Promise<unknown[]> } {
  const settled = Promise.resolve([]) as Promise<unknown[]> & { returning?: () => Promise<unknown[]> };
  settled.returning = async () => (bookDeleted ? [] : [{ id: BOOK_ID }]);
  return settled as Promise<unknown[]> & { returning: () => Promise<unknown[]> };
}

mock.module("../../db", () => ({
  db: {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values);
        return { where: () => updateChain() };
      },
    }),
  },
}));
mock.module("../../storage/r2", () => ({ deleteFile: async () => {} }));
mock.module("../../queue", () => ({
  emitProgressEvent: (bookId: string, type: string, payload: Record<string, unknown>) => events.push({ bookId, type, payload }),
}));

const { describeIngestionFailure, reportIngestionFailure } = await import("./failure");

// The line the owner's run actually logged: a rejected TorBox token, then a fallback that handed back a file whose
// spine mapped to nothing, which used to reach the UI as "Could not download this book".
const OWNER_FAILURE =
  "No source produced a readable EPUB. torrents: All 2 torrent candidate(s) failed to download: Shadow Slave epub: " +
  "TorBox failed to add torrent: An error occurred while verifying your token. | open libraries (Internet Archive / " +
  "Open Library, Project Gutenberg, LibGen): no readable EPUB";

beforeEach(() => {
  updates.length = 0;
  events.length = 0;
  bookDeleted = false;
});

describe("describeIngestionFailure", () => {
  it("names both real causes of the owner's run instead of telling them to search again", () => {
    const reason = describeIngestionFailure(new Error(OWNER_FAILURE));

    expect(reason.code).toBe("torbox-auth");
    expect(reason.message).toBe(
      "Your TorBox key was rejected, so torrent downloads could not start. A source sent a file that is not a readable EPUB. " +
        "Renew your TorBox key in Settings, or add this book as an EPUB upload.",
    );
    expect(reason.message).not.toContain("different search");
    expect(reason.detail).toBe(OWNER_FAILURE);
  });

  it("reports a rejected TorBox token on its own as a key problem", () => {
    const reason = describeIngestionFailure(new Error("TorBox failed to add torrent: An error occurred while verifying your token"));

    expect(reason.code).toBe("torbox-auth");
    expect(reason.message).toContain("Renew your TorBox key in Settings");
  });

  it("reports a spine failure as an unreadable EPUB", () => {
    const reason = describeIngestionFailure(new Error("Invalid EPUB: Spine is empty or could not be mapped to files."));

    expect(reason.code).toBe("epub-invalid");
    expect(reason.message).toBe("A source sent a file that is not a readable EPUB. Add this book as an EPUB upload instead.");
  });

  it("keeps a failed download distinct from an unreadable file and from an unreachable source", () => {
    expect(describeIngestionFailure(new Error("The downloaded file exceeds the 200MB size limit.")).code).toBe("download-failed");
    expect(describeIngestionFailure(new Error("fetch failed to www.gutenberg.org")).code).toBe("provider-unreachable");
  });

  it("leaves an unrecognised failure honest rather than guessing a cause", () => {
    const reason = describeIngestionFailure(new Error("TTS quota exceeded"));

    expect(reason.code).toBe("unexpected");
    expect(reason.detail).toBe("TTS quota exceeded");
  });

  it("caps the stored raw detail so one failure cannot store an unbounded log", () => {
    const reason = describeIngestionFailure(new Error(`boom ${"x".repeat(5000)}`));

    expect(reason.detail.length).toBe(2001);
    expect(reason.detail.endsWith("…")).toBe(true);
  });
});

describe("reportIngestionFailure", () => {
  it("stores the actionable reason with the book and streams it to the studio log", async () => {
    await reportIngestionFailure(BOOK_ID, new Error(OWNER_FAILURE), undefined);

    expect(updates).toEqual([
      {
        status: "failed",
        failureReason: {
          code: "torbox-auth",
          message: expect.stringContaining("Your TorBox key was rejected"),
          detail: OWNER_FAILURE,
        },
      },
    ]);
    expect(events).toEqual([
      {
        bookId: BOOK_ID,
        type: "status_change",
        payload: { status: "failed", error: expect.stringContaining("not a readable EPUB"), code: "torbox-auth" },
      },
    ]);
  });

  it("keeps an EPUB this run uploaded when the book row survived the failure", async () => {
    await reportIngestionFailure(BOOK_ID, new Error("boom"), { epubR2Key: `books/${BOOK_ID}/original.epub`, uploadedInThisRun: true });

    expect(updates.map((update) => Object.keys(update))).toEqual([["status", "failureReason"], ["epubR2Key"]]);
  });
});
