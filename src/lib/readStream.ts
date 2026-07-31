/**
 * Reads a web ReadableStream fully into a Buffer, aborting once maxBytes is
 * exceeded. Never trusts Content-Length: it counts the bytes that actually
 * arrive off the wire, cancels the reader, and throws the caller-supplied
 * error (kept caller-supplied so each site can throw its own error class and
 * message — validation errors, provider errors, etc.).
 */
export async function readStreamWithCap(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  makeExceededError: () => Error,
  onChunk?: (chunk: Buffer) => void
): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  let exceededError: Error | null = null;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        exceededError = makeExceededError();
        break;
      }
      const chunk = Buffer.from(value);
      chunks.push(chunk);
      onChunk?.(chunk);
    }
  } finally {
    if (exceededError) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (exceededError) throw exceededError;
  return Buffer.concat(chunks);
}
