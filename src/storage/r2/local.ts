import * as fs from "fs/promises";
import * as path from "path";
import { createHash } from "crypto";
import { assertSafeKey } from "../keys";
import { downloadLimitExceededError, fileNotFoundError, MAX_DOWNLOAD_BYTES } from "./errors";
import type { FileStat, StreamRange, StreamResult } from "./types";

const LOCAL_STORAGE_DIR = path.resolve("./.storage");
const LOCAL_KEY_ENCODED_MAX_LENGTH = 200;

export function localPathForKey(key: string): string {
  assertSafeKey(key);
  const encoded = encodeURIComponent(key);
  if (encoded.length <= LOCAL_KEY_ENCODED_MAX_LENGTH) {
    const filePath = path.join(LOCAL_STORAGE_DIR, encoded);
    if (!filePath.startsWith(LOCAL_STORAGE_DIR + path.sep) && filePath !== LOCAL_STORAGE_DIR) {
      throw new Error(`Path escape blocked for key: ${key}`);
    }
    return filePath;
  }
  const hash = createHash("sha256").update(key).digest("hex");
  const shardDir = path.join(LOCAL_STORAGE_DIR, hash.slice(0, 2), hash.slice(2, 4));
  const filePath = path.join(shardDir, hash + "_" + encoded.slice(-100));
  if (!filePath.startsWith(LOCAL_STORAGE_DIR + path.sep)) {
    throw new Error(`Path escape blocked for key: ${key}`);
  }
  return filePath;
}

async function ensureLocalStorage(): Promise<void> {
  await fs.mkdir(LOCAL_STORAGE_DIR, { recursive: true });
}

export async function writeLocalFile(key: string, body: Buffer): Promise<void> {
  await ensureLocalStorage();
  const localPath = localPathForKey(key);
  await fs.mkdir(path.dirname(localPath), { recursive: true });

  const temporaryPath = `${localPath}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  try {
    await fs.writeFile(temporaryPath, body);
    await fs.rename(temporaryPath, localPath);
  } catch (err) {
    await fs.unlink(temporaryPath).catch(() => {});
    throw err;
  }
}

export async function readLocalFile(key: string): Promise<Buffer> {
  await ensureLocalStorage();
  const filePath = localPathForKey(key);
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat) throw fileNotFoundError(key);
  if (stat.size > MAX_DOWNLOAD_BYTES) throw downloadLimitExceededError(key);
  return await fs.readFile(filePath).catch(() => {
    throw fileNotFoundError(key);
  });
}

export async function copyLocalFileToPath(key: string, destPath: string): Promise<number> {
  await ensureLocalStorage();
  const filePath = localPathForKey(key);
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat) throw fileNotFoundError(key);
  if (stat.size > MAX_DOWNLOAD_BYTES) throw downloadLimitExceededError(key);
  await fs.copyFile(filePath, destPath);
  return stat.size;
}

export async function deleteLocalFiles(keys: string[]): Promise<number> {
  const results = await Promise.allSettled(keys.map((key) => fs.unlink(localPathForKey(key))));
  return results.filter((result) => result.status === "rejected").length;
}

export async function deleteLocalFile(key: string): Promise<void> {
  try {
    await fs.unlink(localPathForKey(key));
  } catch {}
}

export async function statLocalFile(key: string): Promise<FileStat> {
  await ensureLocalStorage();
  const stat = await fs.stat(localPathForKey(key));
  if (stat.size <= 0) throw fileNotFoundError(key);
  return { size: stat.size };
}

export async function streamLocalFile(key: string, range: StreamRange | null, knownSize?: number): Promise<StreamResult> {
  await ensureLocalStorage();
  const filePath = localPathForKey(key);
  let totalSize = knownSize ?? 0;
  if (totalSize <= 0) {
    const stat = await fs.stat(filePath);
    totalSize = stat.size;
  }
  const requested = range ? { start: range.start, end: Math.min(range.end, totalSize - 1) } : { start: 0, end: totalSize - 1 };
  const length = requested.end - requested.start + 1;

  return {
    stream: openLocalFileStream(await fs.open(filePath, "r"), requested.start, requested.end),
    length,
    totalSize,
    partial: !!range && length < totalSize,
  };
}

function openLocalFileStream(handle: fs.FileHandle, start: number, end: number): ReadableStream<Uint8Array> {
  let handleClosed = false;
  const closeHandleOnce = () => {
    if (handleClosed) return;
    handleClosed = true;
    handle.close().catch(() => {});
  };
  const nodeStream = handle.createReadStream({ start, end });

  return new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on("data", (chunk: string | Buffer) => {
        controller.enqueue(new Uint8Array(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        if ((controller.desiredSize ?? 0) <= 0) nodeStream.pause();
      });
      nodeStream.on("end", () => {
        closeHandleOnce();
        controller.close();
      });
      nodeStream.on("error", (err: unknown) => {
        closeHandleOnce();
        controller.error(err);
      });
    },
    pull() {
      nodeStream.resume();
    },
    cancel(reason) {
      try {
        nodeStream.destroy(reason);
      } catch {}
      closeHandleOnce();
    },
  });
}
