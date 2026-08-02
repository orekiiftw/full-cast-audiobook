import { resolveRange, statFile, streamFile } from "../../r2";
import { isSafeStorageKey } from "../../audioUtils";
import { json } from "../response";
import { AuthUser } from "../../auth";
import { ownsStorageKey } from "../ownership";

const CONTENT_TYPES: Record<string, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export async function registerAudioRoutes(req: Request, path: string, user: AuthUser): Promise<Response | null> {
  if (path !== "/api/audio" || req.method !== "GET") {
    return null;
  }

  const key = new URL(req.url).searchParams.get("key");
  if (!key) {
    return json({ error: "Missing file key parameter" }, 400);
  }
  if (!isSafeStorageKey(key)) {
    return json({ error: "Invalid file key" }, 400);
  }
  if (!(await ownsStorageKey(user.id, key))) {
    return json({ error: "File not found" }, 404);
  }

  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";

  try {
    const { size } = await statFile(key);
    const rangeHeader = req.headers.get("range");
    const range = resolveRange(rangeHeader, size);

    // A present-but-unsatisfiable Range must be 416, not a silent full-file
    // 200 (which breaks browser seeking and wastes a full object transfer).
    if (rangeHeader && !range) {
      return new Response(null, {
        status: 416,
        headers: {
          "Content-Range": `bytes */${size}`,
          "Accept-Ranges": "bytes",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-store",
        },
      });
    }

    // Pass the already-known size so streamFile skips its own stat/HEAD —
    // one storage round-trip per audio request instead of two.
    const result = await streamFile(key, range, size);

    // Audio (and large cover images) stream straight from the storage backend
    // to the client as a ReadableStream — never materialized in server memory.
    // Range support lets the browser seek and pre-buffer inside a WAV/MP3, so
    // a segment can begin decoding as soon as the leading bytes arrive rather
    // than after the whole file downloads.
    const status = result.partial ? 206 : 200;
    return new Response(result.stream, {
      status,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(result.length),
        "Accept-Ranges": "bytes",
        "X-Content-Type-Options": "nosniff",
        // Authenticated audio: cache briefly for seek/replay smoothness, but
        // never immutably for a year — a shared browser would otherwise keep
        // serving a previous user's audio long after logout.
        "Cache-Control": "private, max-age=300",
        ...(result.partial
          ? { "Content-Range": `bytes ${range!.start}-${range!.end}/${result.totalSize}` }
          : {}),
      },
    });
  } catch {
    // Avoid leaking storage backend details (bucket names, paths, SDK errors).
    return json({ error: "File not found" }, 404);
  }
}
