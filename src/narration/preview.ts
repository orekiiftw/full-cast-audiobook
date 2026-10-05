import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { castMembers } from "../schema";
import { getTTSProvider } from "./tts";
import { getBookVoiceContext } from "./voiceContext";

export async function getVoicePreview(castMember: typeof castMembers.$inferSelect, castId: string): Promise<Buffer | null> {
  const previewVoiceKey = `${castMember.ttsVoiceName}::${castMember.styleString}`;
  if (castMember.previewAudio && castMember.previewVoiceKey === previewVoiceKey) {
    return Buffer.from(castMember.previewAudio, "base64");
  }

  const previewText = `Hello, my name is ${castMember.name}, and I will be your narrator for this audiobook.`;
  const stylePrompt = `${castMember.styleString}, speaking in a natural tone.`;

  try {
    const { language } = await getBookVoiceContext(castMember.bookId);
    const audioBuffer = await getTTSProvider(language).speak(previewText, castMember.ttsVoiceName, stylePrompt);
    await storeVoicePreview(castMember, castId, previewVoiceKey, audioBuffer);
    return audioBuffer;
  } catch {
    return null;
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
