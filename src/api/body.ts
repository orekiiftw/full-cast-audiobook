import { readStreamWithCap } from "../lib/readStream";
import { ValidationError } from "../lib/validators";

const DEFAULT_BODY_LIMIT_BYTES = 5 * 1024 * 1024;

const BODY_TOO_LARGE = "Request body too large.";

export async function readBodyWithLimit(req: Request, limitBytes: number = DEFAULT_BODY_LIMIT_BYTES): Promise<Buffer> {
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > limitBytes) {
    throw new ValidationError(BODY_TOO_LARGE);
  }

  const bodyStream = req.body;
  if (!bodyStream) {
    const text = await req.text();
    if (Buffer.byteLength(text) > limitBytes) {
      throw new ValidationError(BODY_TOO_LARGE);
    }
    return Buffer.from(text);
  }

  return readStreamWithCap(bodyStream, limitBytes, () => new ValidationError(BODY_TOO_LARGE));
}

export async function readJsonWithLimit<T = unknown>(req: Request, limitBytes: number = DEFAULT_BODY_LIMIT_BYTES): Promise<T> {
  const buffer = await readBodyWithLimit(req, limitBytes);
  const text = buffer.toString("utf-8");
  const parsed = JSON.parse(text.length > 0 ? text : "{}") as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ValidationError("Request body must be a JSON object.");
  }
  return parsed as T;
}
