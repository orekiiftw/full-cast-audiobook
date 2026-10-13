import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { readVerifiedBook, selectTorrentFile } from "./download";
import { ZIP_BUFFER, zipResponse } from "./testSupport";

describe("selectTorrentFile md5 file selection", () => {
  const files = [
    { id: 0, name: "some-other-book.epub", size: 1000 },
    { id: 1, name: "b1e343791047b776b0e308e5f34a70b4.epub", size: 2000 },
    { id: 2, name: "book.epub.txt", size: 500 },
  ];

  test("picks the file whose name contains the expected md5, even when it is not first", () => {
    const target = selectTorrentFile(files, "b1e343791047b776b0e308e5f34a70b4");
    expect(target?.id).toBe(1);
  });

  test("normalizes a hashed filename with a compression suffix", () => {
    const zips = [
      { id: 0, name: "wrong.epub", size: 100 },
      { id: 1, name: "b1e343791047b776b0e308e5f34a70b4.epub.gz", size: 100 },
    ];
    expect(selectTorrentFile(zips, "b1e343791047b776b0e308e5f34a70b4")?.id).toBe(1);
  });

  test("falls back to the first exact epub when no md5 matches", () => {
    expect(selectTorrentFile(files, "nonexistentdeadbeefdeadbeefdeadbeef")?.id).toBe(0);
  });

  test("ignores an expected md5 that is not 32 hex characters", () => {
    const withCompanion = [
      { id: 0, name: "the-book.epub", size: 2000 },
      { id: 1, name: "dead-sea-companion.epub", size: 100 },
    ];
    expect(selectTorrentFile(withCompanion, "dead")?.id).toBe(0);
  });

  test("skips sample chapters and .epub.txt decoys", () => {
    const decoys = [
      { id: 0, name: "book.epub.txt", size: 100 },
      { id: 1, name: "book_sample.epub", size: 100 },
      { id: 2, name: "actual-book.epub", size: 200 },
    ];
    expect(selectTorrentFile(decoys)?.id).toBe(2);
  });
});

describe("readVerifiedBook md5 check", () => {
  test("rejects bytes that do not hash to the expected md5", async () => {
    await expect(readVerifiedBook(zipResponse(), "book.epub", "0".repeat(32))).rejects.toThrow("expected md5");
  });

  test("accepts bytes that hash to the expected md5", async () => {
    const md5 = createHash("md5").update(ZIP_BUFFER).digest("hex");
    expect((await readVerifiedBook(zipResponse(), "book.epub", md5)).buffer).toEqual(ZIP_BUFFER);
  });
});
