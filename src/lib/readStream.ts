export function bufferToStream(buffer: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(buffer));
      controller.close();
    },
  });
}

export async function readStreamWithCap(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  makeExceededError: () => Error,
  onChunk?: (chunk: Buffer) => void,
): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  let capExceededError: Error | null = null;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        capExceededError = makeExceededError();
        break;
      }
      const chunk = Buffer.from(value);
      chunks.push(chunk);
      onChunk?.(chunk);
    }
  } finally {
    if (capExceededError) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }

  if (capExceededError) throw capExceededError;
  return Buffer.concat(chunks);
}
