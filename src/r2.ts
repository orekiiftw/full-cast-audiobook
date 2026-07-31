import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import * as fs from "fs/promises";
import * as path from "path";
import { isSafeStorageKey } from "./audioUtils";

/**
 * Storage backend selection is fixed at boot:
 * - R2 when fully configured → R2 only (no silent local fallback)
 * - otherwise → local ./.storage only
 *
 * Mixing backends on failure caused split-brain (write local / read R2 → 404).
 */
const hasR2 = !!(
  process.env.R2_ACCESS_KEY_ID &&
  process.env.R2_SECRET_ACCESS_KEY &&
  process.env.R2_ENDPOINT &&
  process.env.R2_BUCKET
);

const s3Client = hasR2
  ? new S3Client({
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
      region: "auto",
      forcePathStyle: true,
    })
  : null;

if (!hasR2) {
  console.warn(
    "⚠️ R2 Storage environment variables are not fully configured. Using local file storage under './.storage/'"
  );
}

const LOCAL_STORAGE_DIR = path.resolve("./.storage");
const R2_BUCKET = process.env.R2_BUCKET;

function assertSafeKey(key: string): void {
  if (!isSafeStorageKey(key)) {
    throw new Error(`Invalid storage key: ${key}`);
  }
}

function localPathForKey(key: string): string {
  assertSafeKey(key);
  const safeName = encodeURIComponent(key);
  const filePath = path.join(LOCAL_STORAGE_DIR, safeName);
  if (!filePath.startsWith(LOCAL_STORAGE_DIR + path.sep) && filePath !== LOCAL_STORAGE_DIR) {
    throw new Error(`Path escape blocked for key: ${key}`);
  }
  return filePath;
}

async function ensureLocalStorage() {
  await fs.mkdir(LOCAL_STORAGE_DIR, { recursive: true });
}

export async function uploadFile(key: string, body: Buffer, contentType: string): Promise<string> {
  assertSafeKey(key);

  if (s3Client && R2_BUCKET) {
    try {
      await s3Client.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: key,
          Body: body,
          ContentType: contentType,
        })
      );
      return key;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Don't include the bucket name in the (potentially client-facing) message.
      throw new Error(
        `R2 upload failed for "${key}": ${msg}. ` +
          `Create the bucket in Cloudflare R2 or clear R2_* env vars to use local ./.storage/.`
      );
    }
  }

  await ensureLocalStorage();
  await fs.writeFile(localPathForKey(key), body);
  return key;
}

export async function downloadFile(key: string): Promise<Buffer> {
  assertSafeKey(key);

  if (s3Client && R2_BUCKET) {
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
      })
    );
    if (!response.Body) {
      throw new Error(`File not found: ${key}`);
    }
    const bytes = await response.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  await ensureLocalStorage();
  try {
    return await fs.readFile(localPathForKey(key));
  } catch {
    throw new Error(`File not found: ${key}`);
  }
}

/**
 * Deletes an object from the active backend. Missing files are treated as
 * already deleted (idempotent), so callers can purge best-effort.
 */
export async function deleteFile(key: string): Promise<void> {
  if (!isSafeStorageKey(key)) return;

  if (s3Client && R2_BUCKET) {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
      })
    );
    return;
  }

  try {
    await fs.unlink(localPathForKey(key));
  } catch {
    // already gone
  }
}

export interface FileStat {
  /** Total object size in bytes (full object, not just the returned range). */
  size: number;
}

export interface StreamRange {
  /** Inclusive start byte of the requested range. */
  start: number;
  /** Inclusive end byte of the requested range (may equal size-1). */
  end: number;
}

export interface StreamResult {
  /** Readable byte stream of the requested range (or the whole object). */
  stream: ReadableStream<Uint8Array>;
  /** Length in bytes of the returned range. */
  length: number;
  /** Total object size in bytes. */
  totalSize: number;
  /** True when the returned stream is a partial range, not the whole file. */
  partial: boolean;
}

/**
 * Resolves a HTTP "Range" header value into a normalized [start, end] pair
 * against `totalSize`, or returns null when it is absent / unsatisfiable.
 * Supports the common "bytes=START-END", "bytes=START-", and "bytes=-N"
 * (last N bytes) forms.
 */
export function resolveRange(
  rangeHeader: string | null | undefined,
  totalSize: number
): StreamRange | null {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return null;
  const startStr = match[1];
  const endStr = match[2];

  if (startStr === "" && endStr === "") return null; // "bytes=" — ignore
  let start: number;
  let end: number;
  if (startStr === "") {
    // "bytes=-N" → last N bytes
    const n = Number(endStr);
    if (!Number.isFinite(n) || n <= 0) return null;
    start = Math.max(0, totalSize - n);
    end = totalSize - 1;
  } else {
    start = Number(startStr);
    if (!Number.isFinite(start) || start < 0 || start >= totalSize) return null;
    end = endStr === "" ? totalSize - 1 : Number(endStr);
    if (!Number.isFinite(end) || end < start) return null;
    end = Math.min(end, totalSize - 1);
  }
  return { start, end };
}

/**
 * Stats an object (total size only today). Used to set Content-Length and to
 * validate range bounds without downloading the body.
 */
export async function statFile(key: string): Promise<FileStat> {
  assertSafeKey(key);

  if (s3Client && R2_BUCKET) {
    const head = await s3Client.send(
      new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key })
    );
    const size = head.ContentLength ?? 0;
    if (size <= 0) {
      // Fall through to the not-found path so the caller surfaces a 404.
      throw new Error(`File not found: ${key}`);
    }
    return { size };
  }

  await ensureLocalStorage();
  const stat = await fs.stat(localPathForKey(key));
  return { size: stat.size };
}

/**
 * Streams an object (or a byte range of it) directly from the storage backend
 * to the client — never materializing the whole file in memory. Honors HTTP
 * Range requests so the browser can seek and buffer incrementally inside a
 * WAV/MP3 instead of waiting for the entire object to download before the
 * first sample can play. This is what makes segment-to-segment transitions
 * feel instant (combined with client-side prefetching).
 *
 * Callers should set: 206 + Content-Range when `partial`, 200 otherwise;
 * Content-Length = `length`; Accept-Ranges: bytes; and the right Content-Type.
 *
 * `knownSize` lets a caller that already stated the object (e.g. the audio
 * route) skip a duplicate HeadObject/fs.stat round-trip — on remote storage
 * that extra HEAD doubled time-to-first-byte for every audio request.
 */
export async function streamFile(key: string, range: StreamRange | null, knownSize?: number): Promise<StreamResult> {
  assertSafeKey(key);

  if (s3Client && R2_BUCKET) {
    let totalSize = knownSize ?? 0;
    if (totalSize <= 0) {
      const totalHead = await s3Client.send(
        new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key })
      );
      totalSize = totalHead.ContentLength ?? 0;
    }
    if (totalSize <= 0) {
      throw new Error(`File not found: ${key}`);
    }

    const requested = range
      ? { start: range.start, end: Math.min(range.end, totalSize - 1) }
      : { start: 0, end: totalSize - 1 };
    const length = requested.end - requested.start + 1;

    const get = await s3Client.send(
      new GetObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Range: `bytes=${requested.start}-${requested.end}`,
      })
    );

    const body = get.Body as
      | { transformToWebStream?: () => ReadableStream<Uint8Array>; getReader?: () => ReadableStreamDefaultReader<Uint8Array> }
      | undefined;
    if (!body) {
      throw new Error(`File not found: ${key}`);
    }

    // AWS SDK v3 S3 Body exposes transformToWebStream(); fall back to a
    // Node Readable → web stream adapter if the runtime lacks it.
    interface NodeReadableLike {
      pipe?: unknown;
      on(event: "data", cb: (chunk: Uint8Array | Buffer) => void): void;
      on(event: "end" | "error", cb: (err?: unknown) => void): void;
      destroy?(reason?: unknown): void;
    }
    let stream: ReadableStream<Uint8Array>;
    if (typeof body.transformToWebStream === "function") {
      stream = body.transformToWebStream();
    } else if (typeof (get.Body as NodeReadableLike | undefined)?.pipe === "function") {
      const nodeStream = get.Body as unknown as NodeReadableLike;
      stream = new ReadableStream({
        start(controller) {
          nodeStream.on("data", (chunk: Uint8Array | Buffer) =>
            controller.enqueue(new Uint8Array(chunk))
          );
          nodeStream.on("end", () => controller.close());
          nodeStream.on("error", (err: unknown) => controller.error(err));
        },
        cancel(reason) {
          try {
            nodeStream.destroy?.(reason);
          } catch {
            // best-effort
          }
        },
      });
    } else {
      throw new Error("Unsupported storage body stream");
    }

    return {
      stream,
      length,
      totalSize,
      partial: !!range && length < totalSize,
    };
  }

  await ensureLocalStorage();
  const filePath = localPathForKey(key);
  let totalSize = knownSize ?? 0;
  if (totalSize <= 0) {
    const stat = await fs.stat(filePath);
    totalSize = stat.size;
  }
  const requested = range
    ? { start: range.start, end: Math.min(range.end, totalSize - 1) }
    : { start: 0, end: totalSize - 1 };
  const length = requested.end - requested.start + 1;

  const nodeStream = await fs.open(filePath, "r").then((handle) =>
    handle.createReadStream({ start: requested.start, end: requested.end })
  );

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on("data", (chunk: string | Buffer) =>
        controller.enqueue(new Uint8Array(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      );
      nodeStream.on("end", () => controller.close());
      nodeStream.on("error", (err: unknown) => controller.error(err));
    },
    cancel(reason) {
      try {
        nodeStream.destroy(reason);
      } catch {
        // best-effort
      }
    },
  });

  return {
    stream,
    length,
    totalSize,
    partial: !!range && length < totalSize,
  };
}

export async function fileExists(key: string): Promise<boolean> {  if (!isSafeStorageKey(key)) return false;

  if (s3Client && R2_BUCKET) {
    try {
      await s3Client.send(
        new HeadObjectCommand({
          Bucket: R2_BUCKET,
          Key: key,
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  try {
    await ensureLocalStorage();
    await fs.access(localPathForKey(key));
    return true;
  } catch {
    return false;
  }
}
