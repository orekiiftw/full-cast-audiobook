import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { castMembers } from "../schema";
import { acquireLock, isLockHeld, releaseLock } from "../queue";
import { sleep } from "../lib/async";
import { firstRow } from "../lib/query";
import { getTTSProvider } from "./tts";
import { getBookVoiceContext } from "./voiceContext";

type CastMemberRow = typeof castMembers.$inferSelect;

// Outlasts the TTS client's worst case (three 45s attempts plus backoff) so a slow synthesis is not started twice.
const PREVIEW_LOCK_TTL_MS = 3 * 60_000;

// Below the server's 120s idle timeout, so a request waiting on another one's synthesis still gets an answer.
const PREVIEW_WAIT_MS = 90_000;

const PREVIEW_POLL_INTERVAL_MS = 500;

export async function getVoicePreview(castMember: CastMemberRow, castId: string): Promise<Buffer | null> {
  const cached = cachedPreview(castMember);
  if (cached) return cached;

  try {
    const lockName = `preview:${castId}`;
    const lockToken = await acquireLock(lockName, PREVIEW_LOCK_TTL_MS);
    if (!lockToken) return await awaitInFlightPreview(castId, lockName);

    try {
      const latest = await loadCastMember(castId);
      if (!latest) return null;
      return cachedPreview(latest) ?? (await synthesizePreview(latest, castId));
    } finally {
      await releaseLock(lockName, lockToken);
    }
  } catch {
    return null;
  }
}

// The lock holder stores the preview before releasing the lock, so one read after release sees its result.
async function awaitInFlightPreview(castId: string, lockName: string): Promise<Buffer | null> {
  const deadline = Date.now() + PREVIEW_WAIT_MS;
  while ((await isLockHeld(lockName)) && Date.now() < deadline) {
    await sleep(PREVIEW_POLL_INTERVAL_MS);
  }
  const latest = await loadCastMember(castId);
  return latest ? cachedPreview(latest) : null;
}

async function synthesizePreview(castMember: CastMemberRow, castId: string): Promise<Buffer> {
  const previewText = `Hello, my name is ${castMember.name}, and I will be your narrator for this audiobook.`;
  const stylePrompt = `${castMember.styleString}, speaking in a natural tone.`;

  const { language } = await getBookVoiceContext(castMember.bookId);
  const audioBuffer = await getTTSProvider(language).speak(previewText, castMember.ttsVoiceName, stylePrompt);
  await storeVoicePreview(castMember, castId, audioBuffer);
  return audioBuffer;
}

function cachedPreview(castMember: CastMemberRow): Buffer | null {
  if (!castMember.previewAudio || castMember.previewVoiceKey !== previewVoiceKey(castMember)) return null;
  return Buffer.from(castMember.previewAudio, "base64");
}

function previewVoiceKey(castMember: CastMemberRow): string {
  return `${castMember.ttsVoiceName}::${castMember.styleString}`;
}

function loadCastMember(castId: string): Promise<CastMemberRow | undefined> {
  return firstRow(db.select().from(castMembers).where(eq(castMembers.id, castId)));
}

async function storeVoicePreview(castMember: CastMemberRow, castId: string, audioBuffer: Buffer): Promise<void> {
  await db
    .update(castMembers)
    .set({
      previewAudio: audioBuffer.toString("base64"),
      previewVoiceKey: previewVoiceKey(castMember),
      previewGen: castMember.previewGen + 1,
    })
    .where(and(eq(castMembers.id, castId), eq(castMembers.previewGen, castMember.previewGen)));
}
