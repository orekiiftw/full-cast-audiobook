import { createHash } from "crypto";
import { ValidationError } from "../lib/validators";
import type { BookResult } from "../acquisition";

const MAX_TITLE_LENGTH = 500;

const MAX_AUTHOR_LENGTH = 500;

const MAX_MAGNET_LENGTH = 2048;

export interface BookSubmission {
  title: string;
  author: string;
  magnetOrHash: string;
  requestedProviderBook?: { provider: string; id: string };
  providerBook?: BookResult;
  epubBuffer?: Buffer;
}

export function assertSubmissionBounds({ title, author, magnetOrHash }: BookSubmission): void {
  if (title.length > MAX_TITLE_LENGTH) throw new ValidationError(`title must be ${MAX_TITLE_LENGTH} characters or fewer`);
  if (author.length > MAX_AUTHOR_LENGTH) throw new ValidationError(`author must be ${MAX_AUTHOR_LENGTH} characters or fewer`);
  if (magnetOrHash.length > MAX_MAGNET_LENGTH) throw new ValidationError(`magnet must be ${MAX_MAGNET_LENGTH} characters or fewer`);
}

export function assertSubmissionHasSource({ title, author, epubBuffer, magnetOrHash, providerBook }: BookSubmission): void {
  if (!epubBuffer && !magnetOrHash && !providerBook && (!title || !author)) {
    throw new ValidationError("Please upload an EPUB file, supply a magnet/hash link, or provide a Title + Author.");
  }
}

export function hashSubmission({ epubBuffer, magnetOrHash, providerBook, title, author }: BookSubmission): string {
  const hashInput =
    epubBuffer ?? Buffer.from(magnetOrHash || (providerBook ? `${providerBook.provider}:${providerBook.id}` : `${title}-${author}`));
  return createHash("sha256").update(hashInput).digest("hex");
}
