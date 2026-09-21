import { readStreamWithCap } from "../../lib/readStream";
import { BookNotFoundError, ProviderUnavailableError } from "../errors";
import { AcquiredBook, BookDetails, BookFormat, BookProvider, BookResult, SearchQuery } from "../types";
import { acquireFirstUsableEpub, parseYear } from "./shared";

interface LibgenSearchContext {
  providerName: string;
  baseUrl: string;
  wantedFormats: Set<string>;
  limit: number;
}

const MAX_LIBGEN_SEARCH_BYTES = 8 * 1024 * 1024;

export class LibgenProvider implements BookProvider {
  readonly name = "libgen";
  private readonly base = "https://libgen.li";

  async search(query: SearchQuery): Promise<BookResult[]> {
    const term = [query.title, query.author].filter(Boolean).join(" ").trim();
    if (!term) return [];

    const url = `${this.base}/index.php?req=${encodeURIComponent(term)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" } });
    if (!res.ok) throw new ProviderUnavailableError(`LibGen search returned HTTP ${res.status}`, this.name);
    if (!res.body) throw new ProviderUnavailableError("LibGen search returned an empty body.", this.name);
    const buffer = await readStreamWithCap(
      res.body,
      MAX_LIBGEN_SEARCH_BYTES,
      () => new ProviderUnavailableError("LibGen search page exceeded the size limit.", this.name),
    );

    const wantedFormats = new Set<string>((query.formats ?? ["epub"]).filter((format) => format !== "unknown"));
    return parseLibgenSearchPage(buffer.toString("utf-8"), {
      providerName: this.name,
      baseUrl: this.base,
      wantedFormats,
      limit: query.limit ?? 10,
    });
  }

  async getBook(id: string): Promise<BookDetails> {
    return {
      id,
      provider: this.name,
      title: id,
      authors: [],
      format: "epub",
      formats: ["epub"],
      mirrors: [{ id, label: "LibGen", kind: "direct", url: `${this.base}/ads.php?md5=${id}` }],
      metadata: {},
    };
  }

  async acquire(book: BookResult): Promise<AcquiredBook> {
    const md5 = book.id;
    if (!/^[a-f0-9]{32}$/i.test(md5)) throw new BookNotFoundError(`LibGen book id '${md5}' is not an md5.`);

    const ads = await fetch(`${this.base}/ads.php?md5=${md5}`, {
      signal: AbortSignal.timeout(30_000),
      headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" },
    });
    if (!ads.ok) throw new ProviderUnavailableError(`LibGen download page returned HTTP ${ads.status}`, this.name);
    const key = (await ads.text()).match(/get\.php\?md5=([a-f0-9]{32})&key=([A-Za-z0-9]+)/i);
    if (!key) throw new BookNotFoundError(`LibGen has no download key for '${md5}'.`);

    const res = await fetch(`${this.base}/get.php?md5=${key[1]}&key=${key[2]}`, {
      signal: AbortSignal.timeout(120_000),
      headers: { "User-Agent": "Mozilla/5.0" },
      redirect: "follow",
    });
    if (!res.ok || !res.body) throw new ProviderUnavailableError(`LibGen download returned HTTP ${res.status}`, this.name);
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("text/html")) {
      const reason = (await res.text())
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 160);
      throw new ProviderUnavailableError(`LibGen served an error page instead of a file: ${reason}`, this.name);
    }

    return {
      stream: res.body,
      filename: `${md5}.${book.format === "unknown" ? "epub" : book.format}`,
      contentType,
      contentLength: Number(res.headers.get("content-length")) || undefined,
    };
  }
}

export async function fetchEpubFromLibgen(
  title: string,
  author?: string,
  onProgress?: (msg: string) => void,
): Promise<{ buffer: Buffer; filename: string } | null> {
  return acquireFirstUsableEpub(new LibgenProvider(), "LibGen", title, author, onProgress);
}

function parseLibgenSearchPage(html: string, context: LibgenSearchContext): BookResult[] {
  const results: BookResult[] = [];
  const seenMd5 = new Set<string>();

  for (const row of html.split(/<tr[^>]*>/i)) {
    const result = parseLibgenRow(row, context, seenMd5);
    if (!result) continue;
    results.push(result);
    if (results.length >= context.limit) break;
  }
  return results;
}

function parseLibgenRow(row: string, context: LibgenSearchContext, seenMd5: Set<string>): BookResult | null {
  const md5 = row.match(/ads\.php\?md5=([a-f0-9]{32})/i)?.[1];
  if (!md5 || seenMd5.has(md5)) return null;

  const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
  if (cells.length < 8) return null;

  const title = stripHtmlTags(cells[0].replace(/<i>[\s\S]*?<\/i>/g, ""));
  if (!title) return null;

  const extension = parseLibgenExtension(cells);
  if (context.wantedFormats.size && !context.wantedFormats.has(extension)) return null;

  seenMd5.add(md5);
  return {
    id: md5,
    provider: context.providerName,
    title,
    authors: parseAuthorList(cells[1]),
    publisher: stripHtmlTags(cells[2]) || undefined,
    year: parseYear(stripHtmlTags(cells[3]).split(";")[0]),
    language: stripHtmlTags(cells[4]) || undefined,
    format: (extension || "unknown") as BookFormat,
    filesize: parseHumanSize(parseLibgenSize(cells)),
    mirrors: [{ id: md5, label: "LibGen", kind: "direct", url: `${context.baseUrl}/ads.php?md5=${md5}` }],
  };
}

function parseLibgenExtension(cells: string[]): string {
  const extensionCell = cells.find((cell) => /^\s*(epub|pdf|mobi|azw3|djvu|fb2)\s*$/i.test(stripHtmlTags(cell)));
  return stripHtmlTags(extensionCell ?? "").toLowerCase();
}

function parseLibgenSize(cells: string[]): string {
  return stripHtmlTags(cells.find((cell) => /file\.php\?id=/i.test(cell)) ?? "");
}

function parseAuthorList(cell: string): string[] {
  return stripHtmlTags(cell)
    .split(",")
    .map((author) => author.trim())
    .filter(Boolean);
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function parseHumanSize(value: string): number | undefined {
  const match = value.match(/([\d.]+)\s*(B|kB|KB|MB|GB)/i);
  if (!match) return undefined;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return undefined;
  const unit = match[2].toLowerCase();
  const scale = unit === "b" ? 1 : unit === "kb" ? 1024 : unit === "mb" ? 1024 ** 2 : 1024 ** 3;
  return Math.round(amount * scale);
}
