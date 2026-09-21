import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { castMembers } from "../../schema";
import { getTTSProvider } from "../../narration/tts";
import { getBookVoiceContext } from "../../narration/voiceContext";
import { binary, json } from "../response";
import { type RouteContext, type RouteTable } from "../route";
import { requireUuid } from "../../lib/validators";
import { ownedCastMember } from "../ownership";

export const castRoutes: RouteTable = {
  "GET /api/cast/:castId/preview": voicePreview,
};

async function voicePreview({ user, params }: RouteContext): Promise<Response> {
  const castId = requireUuid(params.castId, "castId");
  const owned = await ownedCastMember(user.id, castId);
  const castMember = owned?.castMember;
  if (!castMember) {
    return json({ error: "Cast member not found" }, 404);
  }

  const previewVoiceKey = `${castMember.ttsVoiceName}::${castMember.styleString}`;
  if (castMember.previewAudio && castMember.previewVoiceKey === previewVoiceKey) {
    return binary(Buffer.from(castMember.previewAudio, "base64"), "audio/wav");
  }

  return generateVoicePreview(castMember, castId, previewVoiceKey);
}

async function generateVoicePreview(
  castMember: typeof castMembers.$inferSelect,
  castId: string,
  previewVoiceKey: string,
): Promise<Response> {
  const previewText = `Hello, my name is ${castMember.name}, and I will be your narrator for this audiobook.`;
  const stylePrompt = `${castMember.styleString}, speaking in a natural tone.`;

  try {
    const { language } = await getBookVoiceContext(castMember.bookId);
    const audioBuffer = await getTTSProvider(language).speak(previewText, castMember.ttsVoiceName, stylePrompt);

    await storeVoicePreview(castMember, castId, previewVoiceKey, audioBuffer);

    return binary(audioBuffer, "audio/wav");
  } catch {
    return json({ error: "TTS preview failed. Please try again later." }, 500);
  }
}

async function storeVoicePreview(
  castMember: typeof castMembers.$inferSelect,
  castId: string,
  previewVoiceKey: string,
  audioBuffer: Buffer,
): Promise<void> {
  await db
    .update(castMembers)
    .set({
      previewAudio: audioBuffer.toString("base64"),
      previewVoiceKey,
      previewGen: castMember.previewGen + 1,
    })
    .where(and(eq(castMembers.id, castId), eq(castMembers.previewGen, castMember.previewGen)));
}
