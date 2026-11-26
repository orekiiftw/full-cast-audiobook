import { eq } from "drizzle-orm";
import { errorMessage } from "../../lib/errors";
import { db } from "../../db";
import { books, type IngestionFailureCode, type IngestionFailureReason } from "../../schema";
import { deleteFile } from "../../storage/r2";
import { emitProgressEvent } from "../../queue";
import type { StoredEpub } from "./persistence";

const MAX_DETAIL_CHARS = 2000;

type CauseCode = Exclude<IngestionFailureCode, "unexpected">;

interface Cause {
  code: CauseCode;
  pattern: RegExp;
  /** What went wrong, without advice, so several causes can be reported in one message. */
  sentence: string;
  /** What the person can do about it when this is the primary cause. */
  advice: string;
}

// The order is the order a person should read the causes in: a rejected TorBox key explains the torrent failure,
// an unreadable download explains why the fallback did not rescue it.
const CAUSES: Cause[] = [
  {
    code: "torbox-auth",
    pattern: /torbox[^|]{0,240}?(token|api[\s_-]?key)|(?:token|api[\s_-]?key)[^|]{0,120}?(rejected|invalid|unauthori[sz]ed|expired|verif)/i,
    sentence: "Your TorBox key was rejected, so torrent downloads could not start.",
    advice: "Renew your TorBox key in Settings, or add this book as an EPUB upload.",
  },
  {
    code: "epub-invalid",
    pattern: /not a readable epub|no readable epub|invalid epub|spine is empty|not a valid zip archive|missing meta-inf\/container\.xml/i,
    sentence: "A source sent a file that is not a readable EPUB.",
    advice: "Add this book as an EPUB upload instead.",
  },
  {
    code: "provider-unreachable",
    pattern: /unreachable|unavailable|could not be reached|fetch failed|enotfound|econnrefused|econnreset|etimedout|socket hang up/i,
    sentence: "A book source could not be reached.",
    advice: "Try again in a few minutes, or add this book as an EPUB upload.",
  },
  {
    code: "download-failed",
    pattern: /download|candidate|timed out|too large|size limit/i,
    sentence: "The download did not finish.",
    advice: "Try again in a few minutes, or add this book as an EPUB upload.",
  },
];

const UNEXPECTED: IngestionFailureReason = {
  code: "unexpected",
  message: "Ingestion failed unexpectedly. The recorded detail names the cause.",
  detail: "",
};

export function describeIngestionFailure(error: unknown): IngestionFailureReason {
  const detail = truncate(errorMessage(error));
  const matched = CAUSES.filter((cause) => cause.pattern.test(detail));
  if (matched.length === 0) return { ...UNEXPECTED, detail };

  // A specific cause already explains why the download added nothing, so the generic sentence would just be noise.
  const reported = matched.length > 1 ? matched.filter((cause) => cause.code !== "download-failed") : matched;
  const [primary] = reported;

  return {
    code: primary.code,
    message: [...reported.map((cause) => cause.sentence), primary.advice].join(" "),
    detail,
  };
}

export async function reportIngestionFailure(bookId: string, error: unknown, storedEpub: StoredEpub | undefined): Promise<void> {
  const reason = describeIngestionFailure(error);
  console.error(`❌ Ingestion failed for Book ${bookId}: ${reason.message}`, error);

  await db.update(books).set({ status: "failed", failureReason: reason }).where(eq(books.id, bookId));

  if (storedEpub?.uploadedInThisRun) {
    await persistUploadedEpubOrPurge(bookId, storedEpub.epubR2Key);
  }

  emitProgressEvent(bookId, "status_change", { status: "failed", error: reason.message, code: reason.code });
}

function truncate(detail: string): string {
  return detail.length > MAX_DETAIL_CHARS ? `${detail.slice(0, MAX_DETAIL_CHARS)}…` : detail;
}

async function persistUploadedEpubOrPurge(bookId: string, epubR2Key: string): Promise<void> {
  try {
    const persisted = await db.update(books).set({ epubR2Key }).where(eq(books.id, bookId)).returning({ id: books.id });
    if (persisted.length === 0) {
      await deleteFile(epubR2Key).catch((err) => console.warn(`Could not purge orphaned EPUB of deleted book (${bookId}):`, err));
    }
  } catch {}
}
