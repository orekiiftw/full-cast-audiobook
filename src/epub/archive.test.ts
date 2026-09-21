import { expect, test } from "bun:test";
import * as fflate from "fflate";
import { validateZipDecompressedSize } from "./archive";

test("validateZipDecompressedSize accepts valid archive within limit", () => {
  const zipBytes = fflate.zipSync({
    "file1.txt": fflate.strToU8("Hello World"),
  });
  const buf = Buffer.from(zipBytes);
  expect(() => validateZipDecompressedSize(buf, 1000)).not.toThrow();
});

test("validateZipDecompressedSize rejects over-budget archive", () => {
  const zipBytes = fflate.zipSync({
    "file1.txt": fflate.strToU8("A".repeat(500)),
  });
  const buf = Buffer.from(zipBytes);
  expect(() => validateZipDecompressedSize(buf, 100)).toThrow(/unreasonable size/);
});

test("validateZipDecompressedSize rejects a single entry over the per-entry cap even when the total fits", () => {
  const zipBytes = fflate.zipSync({
    "huge.html": fflate.strToU8("A".repeat(500)),
    "small.txt": fflate.strToU8("tiny"),
  });
  const buf = Buffer.from(zipBytes);
  expect(() => validateZipDecompressedSize(buf, 1000, 100)).toThrow(/unreasonable size/);
  expect(() => validateZipDecompressedSize(buf, 1000, 600)).not.toThrow();
});

test("validateZipDecompressedSize rejects non-zip or truncated buffer", () => {
  expect(() => validateZipDecompressedSize(Buffer.alloc(10), 1000)).toThrow(/not a valid ZIP/);
  expect(() => validateZipDecompressedSize(Buffer.from("not a zip file at all 1234567890"), 1000)).toThrow(/not a valid ZIP/);
});

test("validateZipDecompressedSize rejects ZIP64 locator", () => {
  const zipBytes = fflate.zipSync({ "file.txt": fflate.strToU8("data") });
  const buf = Buffer.from(zipBytes);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  expect(eocd).toBeGreaterThanOrEqual(20);
  const forged = Buffer.from(buf);
  forged.writeUInt32LE(0x07064b50, eocd - 20);
  expect(() => validateZipDecompressedSize(forged, 10000)).toThrow(/unreasonable size/);
});

test("validateZipDecompressedSize rejects corrupted central directory entries instead of silent pass", () => {
  const zipBytes = fflate.zipSync({ "file.txt": fflate.strToU8("data") });
  const buf = Buffer.from(zipBytes);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const corrupted = Buffer.from(buf);
  corrupted.writeUInt32LE(0x00000000, cdOffset);
  expect(() => validateZipDecompressedSize(corrupted, 10000)).toThrow(/corrupted ZIP central directory/);
});

test("validateZipDecompressedSize rejects disk-vs-total entry count divergence (tiny-file bomb)", () => {
  const files: Record<string, Uint8Array> = {};
  for (let i = 0; i < 6; i++) files[`file${i}.txt`] = fflate.strToU8("A".repeat(300));
  const zipBytes = fflate.zipSync(files);
  let eocd = -1;
  for (let i = zipBytes.length - 22; i >= 0; i--) {
    if (Buffer.from(zipBytes).readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  expect(eocd).toBeGreaterThan(0);
  const forged = Buffer.from(zipBytes);
  forged.writeUInt16LE(1, eocd + 10);
  expect(() => validateZipDecompressedSize(forged, 1000)).toThrow(/unreasonable size/);
  expect(() => validateZipDecompressedSize(Buffer.from(zipBytes), 1000)).toThrow(/unreasonable size/);
  expect(() => validateZipDecompressedSize(Buffer.from(zipBytes), 5000)).not.toThrow();
});
