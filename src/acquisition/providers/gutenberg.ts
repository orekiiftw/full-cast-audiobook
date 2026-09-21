import { BookNotFoundError, ProviderUnavailableError } from "../errors";
import { AcquiredBook, BookDetails, BookProvider, BookResult, SearchQuery } from "../types";
import { acquireFirstUsableEpub, readProviderJson } from "./shared";

interface GutendexBook {
  id: number;
  title?: string;
  authors?: Array<{ name?: string }>;
  languages?: string[];
  download_count?: number;
  formats?: Record<string, string>;
}

interface GutendexSearchResponse {
  results?: GutendexBook[];
}

const GUTENBERG_HOSTS = ["gutenberg.org", "www.gutenberg.org"];

export class GutenbergProvider implements BookProvider {
  readonly name = "gutenberg";

  async search(query: SearchQuery): Promise<BookResult[]> {
    const term = [query.title, query.author].filter(Boolean).join(" ").trim();
    if (!term) return [];

    const url = `https://gutendex.com/books/?search=${encodeURIComponent(term)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(45_000), headers: { Accept: "application/json" } });
    if (!res.ok) throw new ProviderUnavailableError(`Gutendex search returned HTTP ${res.status}`, this.name);
    const data = await readProviderJson<GutendexSearchResponse>(res, "Gutendex search", this.name);

    return (data.results ?? []).flatMap((book) => toGutendexResult(this.name, query, book)).slice(0, query.limit ?? 10);
  }

  async getBook(id: string): Promise<BookDetails> {
    const results = await this.search({ title: id, limit: 1 });
    const match = results.find((result) => result.id === id) ?? results[0];
    if (!match) throw new BookNotFoundError(`Project Gutenberg book '${id}' not found.`);
    return { ...match, formats: ["epub"], metadata: {} };
  }

  async acquire(book: BookResult): Promise<AcquiredBook> {
    return acquireDirectEpub(book, GUTENBERG_HOSTS, this.name);
  }
}

export async function fetchEpubFromGutenberg(
  title: string,
  author?: string,
  onProgress?: (msg: string) => void,
): Promise<{ buffer: Buffer; filename: string } | null> {
  return acquireFirstUsableEpub(new GutenbergProvider(), "Project Gutenberg", title, author, onProgress);
}

function toGutendexResult(providerName: string, query: SearchQuery, book: GutendexBook): BookResult[] {
  const epub = book.formats?.["application/epub+zip"];
  if (!epub) return [];
  return [
    {
      id: String(book.id),
      provider: providerName,
      title: book.title || query.title || "Unknown Title",
      authors: (book.authors ?? []).map((author) => author.name ?? "").filter(Boolean),
      language: book.languages?.[0],
      format: "epub",
      rating: book.download_count,
      mirrors: [{ id: String(book.id), label: "Project Gutenberg", kind: "direct", url: epub }],
    },
  ];
}

async function acquireDirectEpub(book: BookResult, allowedHosts: string[], providerName: string): Promise<AcquiredBook> {
  const mirror = book.mirrors.find((candidate) => candidate.url);
  if (!mirror?.url) throw new BookNotFoundError(`No download link resolved for '${book.id}'.`);
  const url = new URL(mirror.url);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || !isAllowedHost(host, allowedHosts)) {
    throw new ProviderUnavailableError(`Invalid download destination: ${host}`, providerName);
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000), redirect: "follow", headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok || !res.body) throw new ProviderUnavailableError(`${providerName} download returned HTTP ${res.status}`, providerName);
  return {
    stream: res.body,
    filename: `${book.id}.epub`,
    contentType: res.headers.get("content-type") ?? "application/epub+zip",
    contentLength: Number(res.headers.get("content-length")) || undefined,
  };
}

function isAllowedHost(host: string, allowedHosts: string[]): boolean {
  return allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}
