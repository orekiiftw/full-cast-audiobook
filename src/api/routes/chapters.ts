import { listChapterSegments } from "../../books";
import { audioUrl, withVersion } from "../../lib/audioUrl";
import { mediaTokenExpiry, signedAudioUrl } from "../../lib/mediaToken";
import { readBearerSessionToken } from "../../auth/sessionTokens";
import { json } from "../response";
import { type RouteContext, type RouteTable } from "../route";
import { ValidationError, requireUuid } from "../../lib/validators";
import { ownedChapter } from "../../books/ownership";

const DECIMAL_DIGITS_RE = /^\d+$/;

export const chapterRoutes: RouteTable = {
  "GET /api/chapters/:chapterId/segments": getChapterSegments,
  "GET /api/chapters/:chapterId/audio": redirectChapterAudio,
};

async function getChapterSegments({ req, user, params }: RouteContext): Promise<Response> {
  const chapterId = requireUuid(params.chapterId, "chapterId");
  const anchorSegmentIndex = readAnchorSegmentIndex(req);
  const owned = await ownedChapter(user.id, chapterId);
  const chapter = owned?.chapter;
  if (!chapter) {
    return json({ error: "Chapter not found" }, 404);
  }

  return json(await listChapterSegments(chapter, chapterId, anchorSegmentIndex));
}

async function redirectChapterAudio({ req, user, params }: RouteContext): Promise<Response> {
  const chapterId = requireUuid(params.chapterId, "chapterId");
  const owned = await ownedChapter(user.id, chapterId);
  const chapter = owned?.chapter;
  if (!chapter) {
    return json({ error: "Chapter not found" }, 404);
  }

  if (chapter.status !== "ready" || !chapter.audioR2Key) {
    return json({ error: "Chapter audio is not stitched or ready yet" }, 400);
  }

  const location = readBearerSessionToken(req)
    ? signedAudioUrl(chapter.audioR2Key, user.id, mediaTokenExpiry())
    : audioUrl(chapter.audioR2Key);

  return new Response(null, {
    status: 302,
    headers: {
      Location: withVersion(location, chapter.durationMs),
    },
  });
}

function readAnchorSegmentIndex(req: Request): number | undefined {
  const at = new URL(req.url).searchParams.get("at");
  if (at === null) return undefined;

  const segmentIndex = Number(at);
  if (!DECIMAL_DIGITS_RE.test(at) || !Number.isSafeInteger(segmentIndex) || segmentIndex < 1) {
    throw new ValidationError("Query parameter at must be a positive integer");
  }
  return segmentIndex;
}
