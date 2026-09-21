import { isSafeStorageKey, assertSafeKey } from "../keys";
import {
  downloadFromS3,
  downloadFromS3ToPath,
  deleteS3Object,
  deleteS3Objects,
  statS3Object,
  streamS3Object,
  uploadToS3,
  usesS3,
} from "./s3";
import {
  copyLocalFileToPath,
  deleteLocalFile,
  deleteLocalFiles,
  readLocalFile,
  statLocalFile,
  streamLocalFile,
  writeLocalFile,
} from "./local";
import type { FileStat, StreamRange, StreamResult } from "./types";

export type { FileStat, StreamRange, StreamResult } from "./types";

export async function uploadFile(key: string, body: Buffer, contentType: string): Promise<string> {
  assertSafeKey(key);

  if (usesS3()) {
    await uploadToS3(key, body, contentType);
    return key;
  }

  await writeLocalFile(key, body);
  return key;
}

export async function downloadFile(key: string): Promise<Buffer> {
  assertSafeKey(key);
  return usesS3() ? downloadFromS3(key) : readLocalFile(key);
}

export async function downloadFileToPath(key: string, destPath: string): Promise<number> {
  assertSafeKey(key);
  return usesS3() ? downloadFromS3ToPath(key, destPath) : copyLocalFileToPath(key, destPath);
}

export async function deleteFiles(keys: string[]): Promise<number> {
  const safeKeys = keys.filter((key) => isSafeStorageKey(key));
  if (safeKeys.length === 0) return 0;
  return usesS3() ? deleteS3Objects(safeKeys) : deleteLocalFiles(safeKeys);
}

export async function deleteFile(key: string): Promise<void> {
  if (!isSafeStorageKey(key)) return;
  return usesS3() ? deleteS3Object(key) : deleteLocalFile(key);
}

export async function statFile(key: string): Promise<FileStat> {
  assertSafeKey(key);
  return usesS3() ? statS3Object(key) : statLocalFile(key);
}

export async function streamFile(key: string, range: StreamRange | null, knownSize?: number): Promise<StreamResult> {
  assertSafeKey(key);
  return usesS3() ? streamS3Object(key, range, knownSize) : streamLocalFile(key, range, knownSize);
}

export function resolveRange(rangeHeader: string | null | undefined, totalSize: number): StreamRange | null {
  if (!rangeHeader || totalSize <= 0) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return null;

  const startText = match[1];
  const endText = match[2];
  if (startText === "" && endText === "") return null;

  if (startText === "") {
    const lastBytes = Number(endText);
    if (!Number.isFinite(lastBytes) || lastBytes <= 0) return null;
    return { start: Math.max(0, totalSize - lastBytes), end: totalSize - 1 };
  }

  const start = Number(startText);
  if (!Number.isFinite(start) || start < 0 || start >= totalSize) return null;

  const requestedEnd = endText === "" ? totalSize - 1 : Number(endText);
  if (!Number.isFinite(requestedEnd) || requestedEnd < start) return null;

  return { start, end: Math.min(requestedEnd, totalSize - 1) };
}
