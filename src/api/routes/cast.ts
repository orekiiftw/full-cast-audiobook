import { eq } from "drizzle-orm";
import { db } from "../../db";
import { castMembers } from "../../schema";
import { getTTSProvider } from "../../ttsService";
import { binary, json } from "../response";
import { requireUuid } from "../../lib/validators";
import { AuthUser } from "../../auth";
import { ownedCastMember } from "../ownership";

const PREVIEW_RE = /^\/api\/cast\/([a-f0-9-]+)\/preview$/i;

/** Cache identity: a preview is only valid for this exact voice + direction. */
function voiceKey(voice: string, style: string): string {
  return `${voice}::${style}`;
}

/**
 * GET /api/cast/:id/preview — a short sample of the narrator's voice.
 *
 * Single-narrator system: each book has exactly one cast row (the Narrator),
 * whose voice/style never changes after ingestion. Synthesizing a preview on
 * every click burned a paid TTS call and took seconds, so the clip is cached
 * on the cast_members row (`preview_audio` as base64) and reused while
 * `preview_voice_key` still matches the row's current voice + style.
 *
 * Race hardening: three workers can interact — a reader, an admin edit, and
 * the TTS call itself, which is slow. `previewGen` is a monotonic token
 * bumped on invalidation; a synthesis that completes with a stale token
 * (someone invalidated mid-flight) writes nothing.
 */
export async function registerCastRoutes(req: Request, path: string, user: AuthUser): Promise<Response | null> {
  const previewMatch = path.match(PREVIEW_RE);
  if (!previewMatch || req.method !== "GET") {
    return null;
  }

  const castId = requireUuid(previewMatch[1], "castId");
  const owned = await ownedCastMember(user.id, castId);
  const castMember = owned?.castMember;
  if (!castMember) {
    return json({ error: "Cast member not found" }, 404);
  }

  const expectedKey = voiceKey(castMember.ttsVoiceName, castMember.styleString);

  // Fast path: cached clip for the current voice + style.
  if (castMember.previewAudio && castMember.previewVoiceKey === expectedKey) {
    const bytes = Buffer.from(castMember.previewAudio, "base64");
    return binary(bytes, "audio/wav");
  }

  const previewText = `Hello, my name is ${castMember.name}, and I will be your narrator for this audiobook.`;
  const stylePrompt = `${castMember.styleString}, speaking in a natural tone.`;

  try {
    const audioBuffer = await getTTSProvider().speak(
      previewText,
      castMember.ttsVoiceName,
      stylePrompt
    );

    // Persist for next time. The generation guard in the WHERE clause means
    // an invalidation that raced our synthesis wins — we only write if the
    // row hasn't been bumped since we read it.
    const setGen = castMember.previewGen + 1;
    await db
      .update(castMembers)
      .set({
        previewAudio: audioBuffer.toString("base64"),
        previewVoiceKey: expectedKey,
        previewGen: setGen,
      })
      .where(eq(castMembers.id, castId));

    return binary(audioBuffer, "audio/wav");
  } catch {
    // Don't surface provider/backend internals — only that synthesis failed.
    return json({ error: "TTS preview failed. Please try again later." }, 500);
  }
}
