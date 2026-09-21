import { unzipSync, strFromU8 } from "fflate";
import { EPUB_LIMITS } from "../lib/constants";

interface ZipCentralDirectory {
  entryCount: number;
  offset: number;
}

export type ArchiveEntries = Record<string, Uint8Array>;

const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIR_SIGNATURE = 0x02014b50;
const ZIP_ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const BYTES_PER_MEGABYTE = 1024 * 1024;

export function openEpubArchive(buffer: Buffer): ArchiveEntries {
  validateZipDecompressedSize(buffer, EPUB_LIMITS.MAX_TOTAL_DECOMPRESSED_BYTES, EPUB_LIMITS.MAX_ENTRY_DECOMPRESSED_BYTES);

  try {
    return unzipSync(new Uint8Array(buffer));
  } catch (err) {
    throw new Error(`Invalid EPUB: not a valid ZIP archive (${err instanceof Error ? err.message : String(err)})`);
  }
}

export function findArchiveEntry(entries: ArchiveEntries, entryPath: string): Uint8Array | null {
  if (entries[entryPath]) return entries[entryPath];
  return entries[entryPath.replace(/^\.\//, "")] ?? null;
}

export function readArchiveEntryText(entries: ArchiveEntries, entryPath: string, maxBytes: number, what: string): string {
  const data = findArchiveEntry(entries, entryPath);
  if (!data) throw new Error(`Missing ZIP entry: ${entryPath}`);
  if (data.length > maxBytes) {
    throw new Error(`EPUB ${what} is too large (over ${Math.round(maxBytes / BYTES_PER_MEGABYTE)}MB uncompressed).`);
  }
  return strFromU8(data);
}

export function validateZipDecompressedSize(buffer: Buffer, maxBytes: number, maxEntryBytes: number = Number.MAX_SAFE_INTEGER): void {
  const eocd = findEndOfCentralDirectory(buffer);
  const { entryCount, offset: directoryOffset } = readCentralDirectoryHeader(buffer, eocd);

  let total = 0;
  let offset = directoryOffset;
  for (let index = 0; index < entryCount; index++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== ZIP_CENTRAL_DIR_SIGNATURE) {
      throw new Error("Invalid EPUB: corrupted ZIP central directory");
    }
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);

    total += uncompressedSize === 0xffffffff ? maxBytes + 1 : uncompressedSize;
    if (total > maxBytes) {
      rejectUnreasonableSize();
    }
    if (uncompressedSize !== 0xffffffff && uncompressedSize > maxEntryBytes) {
      throw new Error("This EPUB contains an entry that expands to an unreasonable size and cannot be processed.");
    }

    const nextOffset = offset + 46 + fileNameLength + extraLength + commentLength;
    if (nextOffset > buffer.length && index < entryCount - 1) {
      throw new Error("Invalid EPUB: corrupted ZIP central directory");
    }
    offset = nextOffset;
  }
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  if (buffer.length < 22) {
    return rejectMissingCentralDirectory();
  }

  const minEocd = Math.max(0, buffer.length - 22 - 65535);
  for (let offset = buffer.length - 22; offset >= minEocd; offset--) {
    if (buffer.readUInt32LE(offset) === ZIP_EOCD_SIGNATURE) {
      return offset;
    }
  }
  return rejectMissingCentralDirectory();
}

function rejectMissingCentralDirectory(): never {
  throw new Error("Invalid EPUB: not a valid ZIP archive (missing end of central directory)");
}

function readCentralDirectoryHeader(buffer: Buffer, eocd: number): ZipCentralDirectory {
  if (eocd >= 20 && buffer.readUInt32LE(eocd - 20) === ZIP_ZIP64_LOCATOR_SIGNATURE) {
    rejectUnreasonableSize();
  }

  const diskEntries = buffer.readUInt16LE(eocd + 8);
  const totalEntries = buffer.readUInt16LE(eocd + 10);
  if (diskEntries === 0xffff || totalEntries === 0xffff) {
    rejectUnreasonableSize();
  }

  const offset = buffer.readUInt32LE(eocd + 16);
  if (offset === 0xffffffff) {
    rejectUnreasonableSize();
  }

  return { entryCount: Math.max(diskEntries, totalEntries), offset };
}

function rejectUnreasonableSize(): never {
  throw new Error("This EPUB expands to an unreasonable size and cannot be processed.");
}
