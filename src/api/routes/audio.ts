import { resolveRange, statFile, streamFile, type StreamRange, type StreamResult } from "../../storage/r2";
import { isSafeStorageKey } from "../../storage/keys";
import { corsHeaders, json } from "../response";
import { type RouteContext, type RouteTable } from "../route";
import { ownsStorageKey } from "../../books/ownership";

const CONTENT_TYPES: Record<string, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export const audioRoutes: RouteTable = {
  "GET /api/audio": streamAudio,
};

async function streamAudio({ req, user }: RouteContext): Promise<Response> {
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

  return serveStoredFile(req, key);
}

async function serveStoredFile(req: Request, key: string): Promise<Response> {
  const contentType = CONTENT_TYPES[key.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

  try {
    const rangeHeader = req.headers.get("range");
    const size = rangeHeader ? (await statFile(key)).size : 0;
    const range = resolveRange(rangeHeader, size);

    if (rangeHeader && !range) {
      return rangeNotSatisfiable(size);
    }

    const result = await streamFile(key, range, size > 0 ? size : undefined);
    return streamResponse(result, contentType, range);
  } catch {
    return json({ error: "File not found" }, 404);
  }
}

function rangeNotSatisfiable(size: number): Response {
  return new Response(null, {
    status: 416,
    headers: {
      "Content-Range": `bytes */${size}`,
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      ...corsHeaders(),
    },
  });
}

function streamResponse(result: StreamResult, contentType: string, range: StreamRange | null): Response {
  return new Response(result.stream, {
    status: result.partial ? 206 : 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(result.length),
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=300",
      ...corsHeaders(),
      ...(result.partial ? { "Content-Range": `bytes ${range!.start}-${range!.end}/${result.totalSize}` } : {}),
    },
  });
}
