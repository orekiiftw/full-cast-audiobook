import { parseEpub } from "../../epub";
import { TORRENT } from "../../lib/constants";
import { isAllowedHost } from "../../lib/hosts";
import { detectIndicLanguage, normalizeLanguageCode, INDIC_LANGUAGES } from "../../lib/language";
import { readStreamWithCap } from "../../lib/readStream";
import { redirectFailureMessage, type RedirectGuard } from "../../lib/redirectGuard";
import { isZipBuffer } from "../../lib/validators";
import { errorMessage } from "../../lib/errors";
import { ProviderUnavailableError, UnsupportedFormatError } from "../errors";
import { rankBooks } from "../ranking";
import { AcquiredBook, BookProvider, BookResult } from "../types";

const THIRD_PARTY_JSON_CAP = 8 * 1024 * 1024;

const FALLBACK_CANDIDATE_LIMIT = 25;

const MIN_USABLE_EPUB_BYTES = 5000;

export async function readProviderJson<T>(response: Response, what: string, provider: string): Promise<T> {
  if (!response.body) throw new ProviderUnavailableError(`${what} returned an empty response body.`, provider);
  try {
    const buffer = await readStreamWithCap(
      response.body,
      THIRD_PARTY_JSON_CAP,
      () => new ProviderUnavailableError(`${what} response exceeded the size limit.`, provider),
    );
    return JSON.parse(buffer.toString("utf-8")) as T;
  } catch (err) {
    if (err instanceof ProviderUnavailableError) throw err;
    throw new ProviderUnavailableError(`${what} returned invalid JSON.`, provider);
  }
}

export function parseYear(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value)) return value;
  if (typeof value === "string") {
    const parsed = parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function providerRedirectGuard(label: string, allowedHosts: readonly string[], provider: string): RedirectGuard {
  return {
    approve: (target) => {
      if (target.protocol !== "https:" || !isAllowedHost(target.hostname, allowedHosts)) {
        throw new ProviderUnavailableError(`${label} redirected to an untrusted destination`, provider);
      }
      return target;
    },
    fail: (failure) => new ProviderUnavailableError(redirectFailureMessage(label, failure), provider),
  };
}

export async function acquireFirstUsableEpub(
  provider: BookProvider,
  label: string,
  title: string,
  author: string | undefined,
  onProgress?: (msg: string) => void,
): Promise<{ buffer: Buffer; filename: string } | null> {
  try {
    onProgress?.(`Searching ${label} for "${title}"...`);
    const candidates = await provider.search({ title, author, limit: FALLBACK_CANDIDATE_LIMIT });
    if (!candidates.length) return null;

    for (const result of rankBooks(candidates, { title, author })) {
      const acquired = await acquireCandidate(provider, result, label, onProgress);
      if (acquired) return acquired;
    }
  } catch (err: unknown) {
    console.warn(`${label} search failed: ${errorMessage(err)}`);
  }
  return null;
}

async function acquireCandidate(
  provider: BookProvider,
  result: BookResult,
  label: string,
  onProgress?: (msg: string) => void,
): Promise<{ buffer: Buffer; filename: string } | null> {
  try {
    onProgress?.(`Attempting "${result.title}" from ${label}...`);
    const acquired = await provider.acquire(result);
    const buffer = await readAcquiredBook(acquired);
    if (buffer.length <= MIN_USABLE_EPUB_BYTES || !isZipBuffer(buffer)) return null;
    if (!hasScriptMatchingClaim(result, buffer)) {
      console.warn(`${label} item '${result.id}' claims language '${result.language}' but its text contains no such script; skipping.`);
      return null;
    }
    onProgress?.(`✅ Downloaded "${result.title}" (${(buffer.length / 1024 / 1024).toFixed(2)} MB) from ${label}.`);
    return { buffer, filename: acquired.filename };
  } catch (err: unknown) {
    console.warn(`${label} item '${result.id}' failed to download: ${errorMessage(err)}`);
    return null;
  }
}

async function readAcquiredBook({ stream, contentLength }: AcquiredBook): Promise<Buffer> {
  const exceeded = () => new UnsupportedFormatError("The provider file exceeds the 200MB EPUB limit.");
  if ((contentLength ?? 0) > TORRENT.MAX_FILE_SIZE_BYTES) {
    await stream.cancel().catch(() => {});
    throw exceeded();
  }
  return readStreamWithCap(stream, TORRENT.MAX_FILE_SIZE_BYTES, exceeded);
}

function hasScriptMatchingClaim(result: BookResult, buffer: Buffer): boolean {
  const claimed = normalizeLanguageCode(result.language);
  if (!claimed || !INDIC_LANGUAGES.has(claimed)) return true;
  try {
    const chapters = parseEpub(buffer).chapters;
    const sample = chapters
      .slice(0, 20)
      .map((chapter) => chapter.blocks.map((block) => block.text).join(" "))
      .join("\n");
    return detectIndicLanguage(sample) !== null;
  } catch {
    return true;
  }
}
