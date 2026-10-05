import { TORRENT } from "../../lib/constants";
import { fetchWithRedirectGuard, redirectFailureMessage, type RedirectGuard } from "../../lib/redirectGuard";
import { readStreamWithCap } from "../../lib/readStream";
import { BookNotFoundError, ProviderUnavailableError } from "../errors";
import { AcquiredBook, BookDetails, BookMirror, BookProvider, BookResult, SearchQuery } from "../types";
import { acquireFirstUsableEpub, parseYear, readProviderJson } from "./shared";
import { bufferToStream } from "../../lib/readStream";
import { isAllowedHost } from "../../lib/hosts";

const ARCHIVE_ORG_REDIRECT_HOPS = 5;

const ARCHIVE_DOWNLOAD_TIMEOUT_MS = 90_000;

const ARCHIVE_JSON_TIMEOUT_MS = 10_000;

const ARCHIVE_ORG_ACQUIREABLE_EPUB_FILTERS =
  "mediatype:(texts)+AND+format:(EPUB)+AND+-collection:(inlibrary)+AND+-collection:(printdisabled)";

interface ArchiveSearchDoc {
  identifier: string;
  title?: string;
  creator?: string | string[];
  year?: number | string;
  language?: string;
}

interface ArchiveMetadataResponse {
  metadata?: {
    title?: string;
    creator?: string | string[];
    year?: number | string;
    language?: string;
  };
  files?: Array<{ name?: string; size?: number }>;
}

type ArchiveMirror = BookMirror & { url: string };

export class ArchiveOrgProvider implements BookProvider {
  readonly name = "archive-org";

  async search(query: SearchQuery): Promise<BookResult[]> {
    const term = [query.title, query.author].filter(Boolean).join(" ").trim();
    if (!term) throw new BookNotFoundError("A title is required for Archive.org search.");

    const limit = query.limit ?? 10;
    for (const strategy of buildArchiveSearchStrategies(query, term)) {
      const docs = await this.fetchSearchDocs(strategy, limit);
      if (docs.length) return docs.map((doc) => mapArchiveDoc(this.name, query, doc));
    }
    return [];
  }

  async getBook(id: string): Promise<BookDetails> {
    const metaRes = await fetchArchiveJson(`https://archive.org/metadata/${encodeURIComponent(id)}`, "Archive.org metadata", this.name);
    if (!metaRes.ok) throw new BookNotFoundError(`Archive.org book '${id}' not found (HTTP ${metaRes.status}).`);
    const data = await readProviderJson<ArchiveMetadataResponse>(metaRes, "Archive.org metadata", this.name);
    const meta = data.metadata ?? {};
    const epub = findArchiveEpubFile(data.files ?? [], id);

    return {
      id,
      provider: this.name,
      title: meta.title || id,
      authors: toAuthorList(meta.creator),
      year: parseYear(meta.year),
      language: meta.language,
      format: "epub",
      formats: ["epub"],
      mirrors: [
        {
          id,
          label: "Internet Archive Direct",
          kind: "direct",
          url: `https://archive.org/download/${encodeURIComponent(id)}/${encodeURIComponent(epub.name)}`,
        },
      ],
      metadata: meta,
    };
  }

  async acquire(book: BookResult): Promise<AcquiredBook> {
    const downloadUrl = await this.resolveDownloadUrl(book);
    const response = await this.fetchDownload(downloadUrl);
    if (!response.ok) throw new ProviderUnavailableError(`Archive.org download failed with HTTP ${response.status}`, this.name);
    if (!response.body) throw new ProviderUnavailableError("Empty response body from Archive.org", this.name);

    const buffer = await readStreamWithCap(
      response.body,
      TORRENT.MAX_FILE_SIZE_BYTES,
      () => new ProviderUnavailableError("Archive.org book exceeds maximum file size", this.name),
    );

    return {
      stream: bufferToStream(buffer),
      filename: `${book.id}.epub`,
      contentType: "application/epub+zip",
      contentLength: buffer.length,
    };
  }

  private async fetchSearchDocs(strategy: string, limit: number): Promise<ArchiveSearchDoc[]> {
    const url = `https://archive.org/advancedsearch.php?q=${strategy}&fl[]=identifier,title,creator,year,language,description&output=json&rows=${limit}`;
    const res = await fetchArchiveJson(url, "Archive.org search", this.name);
    if (!res.ok) throw new ProviderUnavailableError(`Archive.org search returned HTTP ${res.status}`, this.name);
    const data = await readProviderJson<{ response?: { docs?: ArchiveSearchDoc[] } }>(res, "Archive.org search", this.name);
    return data.response?.docs ?? [];
  }

  private async resolveDownloadUrl(book: BookResult): Promise<string> {
    const { url } = await this.resolveMirror(book);

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new ProviderUnavailableError("Invalid mirror URL", this.name);
    }
    if (!isTrustedArchiveOrgUrl(parsedUrl)) {
      throw new ProviderUnavailableError("Invalid Archive.org download destination", this.name);
    }
    return url;
  }

  private async resolveMirror(book: BookResult): Promise<ArchiveMirror> {
    const direct = Array.isArray(book.mirrors) ? book.mirrors.find(isDirectArchiveEpubMirror) : undefined;
    if (direct) return direct;

    const details = await this.getBook(book.id);
    const resolved = details.mirrors.find(isArchiveDownloadMirror);
    if (!resolved) throw new BookNotFoundError(`No direct download link resolved for '${book.id}'.`);
    return resolved;
  }

  private async fetchDownload(url: string): Promise<Response> {
    return fetchWithRedirectGuard({
      url,
      timeoutMs: ARCHIVE_DOWNLOAD_TIMEOUT_MS,
      guard: archiveRedirectGuard("Archive.org", this.name),
    });
  }
}

export async function fetchEpubFromArchiveOrg(
  title: string,
  author?: string,
  onProgress?: (msg: string) => void,
): Promise<{ buffer: Buffer; filename: string } | null> {
  return acquireFirstUsableEpub(new ArchiveOrgProvider(), "Internet Archive", title, author, onProgress);
}

function buildArchiveSearchStrategies(query: SearchQuery, term: string): string[] {
  const cleanTerm = sanitizeArchiveSearchTerm(term);
  const cleanTitle = sanitizeArchiveSearchTerm(query.title ?? "");
  return [`(${encodeURIComponent(cleanTerm)})`, cleanTitle ? `title:(${encodeURIComponent(cleanTitle)})` : ""]
    .filter(Boolean)
    .map((clause) => `${ARCHIVE_ORG_ACQUIREABLE_EPUB_FILTERS}+AND+${clause}`);
}

function sanitizeArchiveSearchTerm(term: string): string {
  return term.replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ").trim();
}

function toAuthorList(creator: string | string[] | undefined): string[] {
  if (!creator) return [];
  return Array.isArray(creator) ? creator : [creator];
}

function mapArchiveDoc(providerName: string, query: SearchQuery, doc: ArchiveSearchDoc): BookResult {
  return {
    id: doc.identifier,
    provider: providerName,
    title: doc.title || query.title || "Unknown Title",
    authors: toAuthorList(doc.creator),
    year: parseYear(doc.year),
    language: doc.language,
    format: "epub",
    mirrors: [
      {
        id: doc.identifier,
        label: "Internet Archive",
        kind: "direct",
        url: `https://archive.org/download/${encodeURIComponent(doc.identifier)}`,
      },
    ],
  };
}

type ArchiveEpubFile = { name: string; size?: number };

function findArchiveEpubFile(files: Array<{ name?: string; size?: number }>, id: string): ArchiveEpubFile {
  const epub = files.find((file): file is ArchiveEpubFile => {
    if (typeof file.name !== "string") return false;
    const name = file.name.toLowerCase();
    return name.endsWith(".epub") && !name.endsWith("_lcp.epub");
  });
  if (!epub) throw new BookNotFoundError(`No usable EPUB file found in Archive.org item '${id}'.`);
  return epub;
}

function isDirectArchiveEpubMirror(mirror: BookMirror): mirror is ArchiveMirror {
  if (!mirror.url) return false;
  const url = mirror.url.toLowerCase();
  return url.endsWith(".epub") && !url.endsWith("_lcp.epub");
}

function isArchiveDownloadMirror(mirror: BookMirror): mirror is ArchiveMirror {
  return !!mirror.url && (mirror.url.endsWith(".epub") || mirror.url.includes("/download/"));
}

function isTrustedArchiveOrgUrl(url: URL): boolean {
  return url.protocol === "https:" && isArchiveOrgHost(url.hostname);
}

function isArchiveOrgHost(host: string): boolean {
  const normalizedHost = host.toLowerCase();
  return isAllowedHost(normalizedHost, ["archive.org"]);
}

async function fetchArchiveJson(url: string, what: string, provider: string): Promise<Response> {
  return fetchWithRedirectGuard({
    url,
    timeoutMs: ARCHIVE_JSON_TIMEOUT_MS,
    guard: archiveRedirectGuard(what, provider),
  });
}

function archiveRedirectGuard(label: string, provider: string): RedirectGuard {
  return {
    maxHops: ARCHIVE_ORG_REDIRECT_HOPS,
    approve: (target) => {
      if (!isTrustedArchiveOrgUrl(target)) {
        throw new ProviderUnavailableError(`${label} redirected to an untrusted destination`, provider);
      }
      return target;
    },
    fail: (failure) => new ProviderUnavailableError(redirectFailureMessage(label, failure), provider),
  };
}
