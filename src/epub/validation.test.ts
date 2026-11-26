import { describe, expect, it } from "bun:test";
import { strToU8, zipSync } from "fflate";
import { createMockEpub } from "./testFixture";
import { inspectEpub } from "./validation";

describe("inspectEpub", () => {
  it("accepts an EPUB whose container, package document, and spine resolve", () => {
    expect(inspectEpub(createMockEpub({}))).toBeNull();
  });

  it("rejects an HTML page served in place of a book", () => {
    const page = Buffer.from("<!DOCTYPE html><html><body><h1>404 Not Found</h1></body></html>");

    expect(inspectEpub(page)?.detail).toBe("the download was a web page, not an EPUB");
  });

  it("rejects a PDF and an empty download by name", () => {
    expect(inspectEpub(Buffer.from("%PDF-1.7\n..."))?.detail).toBe("the download was a PDF, not an EPUB");
    expect(inspectEpub(Buffer.alloc(0))?.detail).toBe("the download was empty");
  });

  it("rejects bytes that carry the zip magic but no central directory", () => {
    const truncated = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);

    expect(inspectEpub(truncated)?.detail).toContain("not a valid ZIP archive");
  });

  it("rejects a zip that is not an EPUB at all", () => {
    const plainZip = Buffer.from(zipSync({ "notes.txt": strToU8("no container here") }));

    expect(inspectEpub(plainZip)?.detail).toBe("Invalid EPUB: Missing META-INF/container.xml");
  });

  it("rejects a package document whose spine maps to no files", () => {
    expect(inspectEpub(createMockEpub({ emptySpine: true }))?.detail).toBe("Invalid EPUB: Spine is empty or could not be mapped to files.");
  });
});
