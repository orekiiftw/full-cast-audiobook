import * as fs from "fs/promises";
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { readStreamWithCap } from "../../lib/readStream";
import { downloadLimitExceededError, fileNotFoundError, MAX_DOWNLOAD_BYTES } from "./errors";
import type { FileStat, StreamRange, StreamResult } from "./types";

const DELETE_OBJECTS_BATCH_SIZE = 1000;

interface S3BodyLike {
  transformToWebStream?: () => ReadableStream<Uint8Array>;
  pipe?: unknown;
  pause?(): void;
  resume?(): void;
  on?(event: "data", cb: (chunk: Uint8Array | Buffer) => void): void;
  on?(event: "end" | "error", cb: (err?: unknown) => void): void;
  destroy?(reason?: unknown): void;
}

interface S3NodeStream {
  on(event: "data", cb: (chunk: Uint8Array | Buffer) => void): void;
  on(event: "end" | "error", cb: (err?: unknown) => void): void;
  pause?(): void;
  resume?(): void;
  destroy?(reason?: unknown): void;
}

const s3Client = createClient();

if (!s3Client) {
  console.warn("⚠️ R2 Storage environment variables are not fully configured. Using local file storage under './.storage/'");
}

function createClient(): S3Client | null {
  const { R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, R2_BUCKET } = process.env;
  if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_ENDPOINT || !R2_BUCKET) return null;

  return new S3Client({
    endpoint: R2_ENDPOINT,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
    region: "auto",
    forcePathStyle: true,
  });
}

export function usesS3(): boolean {
  return s3Client !== null;
}

export async function uploadToS3(key: string, body: Buffer, contentType: string): Promise<void> {
  try {
    await s3Client!.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET!,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `R2 upload failed for "${key}": ${message}. Create the bucket in Cloudflare R2 or clear R2_* env vars to use local ./.storage/.`,
    );
  }
}

export async function downloadFromS3(key: string): Promise<Buffer> {
  const stream = await openS3Download(key);
  return readStreamWithCap(stream, MAX_DOWNLOAD_BYTES, () => downloadLimitExceededError(key));
}

async function openS3Download(key: string): Promise<ReadableStream<Uint8Array>> {
  const response = await s3Client!.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key }));
  if (!response.Body) throw fileNotFoundError(key);
  if (response.ContentLength && response.ContentLength > MAX_DOWNLOAD_BYTES) throw downloadLimitExceededError(key);
  return s3BodyToWebStream(response.Body as S3BodyLike);
}

export async function downloadFromS3ToPath(key: string, destPath: string): Promise<number> {
  const reader = (await openS3Download(key)).getReader();
  const handle = await fs.open(destPath, "w");
  let written = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      written += value.byteLength;
      if (written > MAX_DOWNLOAD_BYTES) throw downloadLimitExceededError(key);
      await handle.write(value);
    }
  } catch (err) {
    await fs.unlink(destPath).catch(() => {});
    throw err;
  } finally {
    await handle.close().catch(() => {});
  }
  return written;
}

export async function deleteS3Objects(keys: string[]): Promise<number> {
  let failures = 0;
  for (let start = 0; start < keys.length; start += DELETE_OBJECTS_BATCH_SIZE) {
    const batch = keys.slice(start, start + DELETE_OBJECTS_BATCH_SIZE);
    try {
      const res = await s3Client!.send(
        new DeleteObjectsCommand({
          Bucket: process.env.R2_BUCKET!,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      );
      failures += res.Errors?.length ?? 0;
    } catch {
      failures += batch.length;
    }
  }
  return failures;
}

export async function deleteS3Object(key: string): Promise<void> {
  await s3Client!.send(
    new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET!,
      Key: key,
    }),
  );
}

export async function statS3Object(key: string): Promise<FileStat> {
  const head = await s3Client!.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key }));
  const size = head.ContentLength ?? 0;
  if (size <= 0) throw fileNotFoundError(key);
  return { size };
}

export async function streamS3Object(key: string, range: StreamRange | null, knownSize?: number): Promise<StreamResult> {
  if (!range && (knownSize ?? 0) <= 0) {
    const get = await s3Client!.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key }));
    const body = get.Body as S3BodyLike | undefined;
    const totalSize = get.ContentLength ?? 0;
    if (!body || totalSize <= 0) throw fileNotFoundError(key);
    return {
      stream: s3BodyToWebStream(body),
      length: totalSize,
      totalSize,
      partial: false,
    };
  }

  let totalSize = knownSize ?? 0;
  if (totalSize <= 0) {
    const totalHead = await s3Client!.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key }));
    totalSize = totalHead.ContentLength ?? 0;
  }
  if (totalSize <= 0) throw fileNotFoundError(key);

  const requested = range ? { start: range.start, end: Math.min(range.end, totalSize - 1) } : { start: 0, end: totalSize - 1 };
  const length = requested.end - requested.start + 1;

  const get = await s3Client!.send(
    new GetObjectCommand({
      Bucket: process.env.R2_BUCKET!,
      Key: key,
      Range: `bytes=${requested.start}-${requested.end}`,
    }),
  );

  if (!get.Body) throw fileNotFoundError(key);

  return {
    stream: s3BodyToWebStream(get.Body as S3BodyLike),
    length,
    totalSize,
    partial: !!range && length < totalSize,
  };
}

function s3BodyToWebStream(body: S3BodyLike): ReadableStream<Uint8Array> {
  if (typeof body.transformToWebStream === "function") {
    return body.transformToWebStream();
  }
  if (typeof body.pipe !== "function") {
    throw new Error("Unsupported storage body stream");
  }

  const nodeStream = body as S3BodyLike & S3NodeStream;

  return new ReadableStream({
    start(controller) {
      nodeStream.on("data", (chunk: Uint8Array | Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
        if ((controller.desiredSize ?? 0) <= 0) nodeStream.pause?.();
      });
      nodeStream.on("end", () => controller.close());
      nodeStream.on("error", (err: unknown) => controller.error(err));
    },
    pull() {
      nodeStream.resume?.();
    },
    cancel(reason) {
      try {
        nodeStream.destroy?.(reason);
      } catch {}
    },
  });
}
