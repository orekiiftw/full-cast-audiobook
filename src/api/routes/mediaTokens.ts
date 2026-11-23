import { isSafeStorageKey } from "../../storage/keys";
import { ownsStorageKey } from "../../books/ownership";
import { ValidationError } from "../../lib/validators";
import { mediaTokenExpiry, signedAudioUrl } from "../../lib/mediaToken";
import { readJsonWithLimit } from "../body";
import { json } from "../response";
import { type RouteContext, type RouteTable } from "../route";

const MAX_KEYS = 50;

export const mediaTokenRoutes: RouteTable = {
  "POST /api/media-tokens": issueMediaTokens,
};

async function issueMediaTokens({ req, user }: RouteContext): Promise<Response> {
  const keys = await requestedKeys(req);
  for (const key of keys) {
    if (!isSafeStorageKey(key)) return json({ error: "Invalid file key" }, 400);
  }
  for (const key of keys) {
    if (!(await ownsStorageKey(user.id, key))) return json({ error: "File not found" }, 404);
  }

  const exp = mediaTokenExpiry();
  const urls: Record<string, string> = {};
  for (const key of keys) {
    urls[key] = signedAudioUrl(key, user.id, exp);
  }

  return json({ urls, expiresAt: new Date(exp * 1000).toISOString() });
}

async function requestedKeys(req: Request): Promise<string[]> {
  const body = await readJsonWithLimit(req);
  const raw = (body as { keys?: unknown }).keys;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_KEYS) {
    return invalidKeys();
  }

  const keys: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || entry.length === 0) return invalidKeys();
    keys.push(entry);
  }
  return keys;
}

function invalidKeys(): never {
  throw new ValidationError(`Request body must carry between 1 and ${MAX_KEYS} file keys in keys.`);
}
