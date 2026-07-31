const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * Validates an ID taken from a URL path or request body. Without this, a
 * malformed ID reaches Postgres and surfaces as a 500 cast error instead of a
 * clean 400.
 */
export function requireUuid(value: unknown, field = "id"): string {
  if (!isUuid(value)) {
    throw new ValidationError(`Invalid ${field}: must be a UUID`);
  }
  return value;
}

export function requireField<T>(obj: Record<string, unknown>, key: string): T {
  if (!(key in obj) || obj[key] === undefined || obj[key] === null) {
    throw new ValidationError(`Missing required field: ${key}`);
  }
  return obj[key] as T;
}

export function optionalString(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new ValidationError(`Field ${key} must be a string`);
  return value;
}

/** Optional, trimmed, length-bounded free-text field from a request body. */
export function boundedString(value: unknown, name: string, maxLength: number): string | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new ValidationError(`${name} must be a string of ${maxLength} characters or fewer`);
  }
  return value.trim() || undefined;
}

/** PK\x03\x04 — the local file header signature every ZIP (and EPUB) starts with. */
export function isZipBuffer(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50;
}

export function requireString(obj: Record<string, unknown>, key: string): string {
  const value = requireField<unknown>(obj, key);
  if (typeof value !== "string" || value.length === 0) {
    throw new ValidationError(`Field ${key} must be a non-empty string`);
  }
  return value;
}

export function requireNumber(obj: Record<string, unknown>, key: string): number {
  const value = requireField<unknown>(obj, key);
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new ValidationError(`Field ${key} must be a number`);
  }
  return value;
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** Default cap (bytes) for any request body parsed into memory. */
export const DEFAULT_BODY_LIMIT_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Reads a request body fully into a Buffer, aborting with a ValidationError
 * once `limitBytes` is exceeded. Defends against clients that lie about (or
 * omit) Content-Length: instead of trusting the header, we count the bytes we
 * actually stream off the wire.
 */
export async function readBodyWithLimit(
  req: Request,
  limitBytes: number = DEFAULT_BODY_LIMIT_BYTES
): Promise<Buffer> {
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > limitBytes) {
    throw new ValidationError("Request body too large.");
  }

  if (!req.body) {
    // No streaming body (e.g. no-body or already-consumed): fall back to text.
    const text = await req.text();
    if (Buffer.byteLength(text) > limitBytes) {
      throw new ValidationError("Request body too large.");
    }
    return Buffer.from(text);
  }

  const reader = req.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  let exceeded = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limitBytes) {
        exceeded = true;
        break;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    if (exceeded) {
      await reader.cancel().catch(() => {});
    }
    reader.releaseLock();
  }

  if (exceeded) {
    throw new ValidationError("Request body too large.");
  }
  return Buffer.concat(chunks);
}

/** Parses a JSON body bounded by readBodyWithLimit. */
export async function readJsonWithLimit<T = unknown>(
  req: Request,
  limitBytes: number = DEFAULT_BODY_LIMIT_BYTES
): Promise<T> {
  const buffer = await readBodyWithLimit(req, limitBytes);
  let text = buffer.toString("utf-8");
  if (text.length === 0) text = "{}";
  // Invalid JSON surfaces as a SyntaxError, which the router maps to a 400.
  return JSON.parse(text) as T;
}
