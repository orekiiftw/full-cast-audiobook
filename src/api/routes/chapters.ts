import { listChapterSegments } from "../../books";
import { versionedAudioUrl } from "../../lib/audioUrl";
import { json } from "../response";
import { type RouteContext, type RouteTable } from "../route";
import { requireUuid } from "../../lib/validators";
import { ownedChapter } from "../../books/ownership";

export const chapterRoutes: RouteTable = {
  "GET /api/chapters/:chapterId/segments": getChapterSegments,
  "GET /api/chapters/:chapterId/audio": redirectChapterAudio,
};

async function getChapterSegments({ user, params }: RouteContext): Promise<Response> {
  const chapterId = requireUuid(params.chapterId, "chapterId");
  const owned = await ownedChapter(user.id, chapterId);
  const chapter = owned?.chapter;
  if (!chapter) {
    return json({ error: "Chapter not found" }, 404);
  }

  return json(await listChapterSegments(chapter, chapterId));
}

async function redirectChapterAudio({ user, params }: RouteContext): Promise<Response> {
  const chapterId = requireUuid(params.chapterId, "chapterId");
  const owned = await ownedChapter(user.id, chapterId);
  const chapter = owned?.chapter;
  if (!chapter) {
    return json({ error: "Chapter not found" }, 404);
  }

  if (chapter.status !== "ready" || !chapter.audioR2Key) {
    return json({ error: "Chapter audio is not stitched or ready yet" }, 400);
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: versionedAudioUrl(chapter.audioR2Key, chapter.durationMs),
    },
  });
}
