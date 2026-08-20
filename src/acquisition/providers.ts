import { downloadBookFromTorrent, searchBookTorrent } from "../torboxService";
import { BookNotFoundError, ProviderUnavailableError } from "./errors";
import { AcquiredBook, BookDetails, BookProvider, BookResult, SearchQuery } from "./types";
import { readStreamWithCap } from "../lib/readStream";
import { isZipBuffer } from "../lib/validators";
import { TORRENT } from "../lib/constants";

function parseYear(val: unknown): number | undefined {
  if (typeof val === "number" && Number.isFinite(val) && Number.isInteger(val)) return val;
  if (typeof val === "string") {
    const num = parseInt(val, 10);
    if (Number.isFinite(num)) return num;
  }
  return undefined;
}

/**
 * Compatibility adapter for the existing TorBox-backed torrent acquisition.
 * The TorBox API yields a magnet rather than stable catalogue metadata, so the
 * provider returns a single normalized candidate for a title/author search.
 */
export class TorrentProvider implements BookProvider {
  readonly name = "torrent";

  async search(query: SearchQuery): Promise<BookResult[]> {
    if (!query.title) throw new BookNotFoundError("A title is required for torrent search.");
    const magnet = await searchBookTorrent(query.title, query.author ?? "");
    return [
      {
        id: magnet,
        provider: this.name,
        title: query.title,
        authors: query.author ? [query.author] : [],
        format: "epub",
        mirrors: [{ id: "torbox", label: "TorBox", kind: "torrent", url: magnet }],
      },
    ];
  }
  async getBook(id: string): Promise<BookDetails> {
    if (!id.startsWith("magnet:")) throw new BookNotFoundError("Invalid torrent book identifier.");
    return {
      id,
      provider: this.name,
      title: "Torrent EPUB",
      authors: [],
      format: "epub",
      formats: ["epub"],
      mirrors: [{ id: "torbox", label: "TorBox", kind: "torrent", url: id }],
      metadata: {},
    };
  }
  async acquire(book: BookResult): Promise<AcquiredBook> {
    const result = await downloadBookFromTorrent(book.id);
    return {
      stream: new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array(result.buffer));
          c.close();
        },
      }),
      filename: result.filename,
      contentType: "application/epub+zip",
      contentLength: result.buffer.length,
    };
  }
}

/**
 * Anna's Archive is intentionally disabled by default. The referenced Rust
 * crate is unofficial and this Bun service cannot link Rust crates directly.
 * Its HTML-derived endpoints/download links are not a stable contract, so a
 * production deployment must supply a vetted adapter (typically a separately
 * deployed Rust sidecar) via this interface, rather than scraping in-process.
 */
export class AnnaArchiveProvider implements BookProvider {
  readonly name = "anna-archive";
  async search(_query: SearchQuery): Promise<BookResult[]> {
    throw new ProviderUnavailableError("Anna's Archive adapter is not configured.", this.name);
  }
  async getBook(_id: string): Promise<BookDetails> {
    throw new ProviderUnavailableError("Anna's Archive adapter is not configured.", this.name);
  }
  async acquire(_book: BookResult): Promise<AcquiredBook> {
    throw new ProviderUnavailableError("Anna's Archive adapter is not configured.", this.name);
  }
}

/**
 * Internet Archive / Open Library provider.
 * Offers direct, high-speed, 100% free HTTP downloads for millions of public domain,
 * classic, and regional literature works (e.g., Godan, H.G. Wells, Tolstoy, Austen).
 */
export class ArchiveOrgProvider implements BookProvider {
  readonly name = "archive-org";

  async search(query: SearchQuery): Promise<BookResult[]> {
    const term = [query.title, query.author].filter(Boolean).join(" ").trim();
    if (!term) throw new BookNotFoundError("A title is required for Archive.org search.");
    const cleanTerm = term.replace(/[^\w\s]/g, " ").trim();
    const url = `https://archive.org/advancedsearch.php?q=(${encodeURIComponent(cleanTerm)})+AND+mediatype:(texts)+AND+format:(EPUB)&fl[]=identifier,title,creator,year,language,description&output=json&rows=${query.limit ?? 10}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new ProviderUnavailableError(`Archive.org search returned HTTP ${res.status}`, this.name);
    const data = (await res.json()) as {
      response?: {
        docs?: Array<{
          identifier: string;
          title?: string;
          creator?: string | string[];
          year?: number | string;
          language?: string;
        }>;
      };
    };
    const docs = data.response?.docs ?? [];
    return docs.map((doc) => ({
      id: doc.identifier,
      provider: this.name,
      title: doc.title || query.title || "Unknown Title",
      authors: doc.creator ? (Array.isArray(doc.creator) ? doc.creator : [doc.creator]) : [],
      year: parseYear(doc.year),
      language: doc.language,
      format: "epub" as const,
      mirrors: [
        {
          id: doc.identifier,
          label: "Internet Archive",
          kind: "direct" as const,
          url: `https://archive.org/download/${doc.identifier}`,
        },
      ],
    }));
  }

  async getBook(id: string): Promise<BookDetails> {
    const metaRes = await fetch(`https://archive.org/metadata/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(10000) });
    if (!metaRes.ok) throw new BookNotFoundError(`Archive.org book '${id}' not found (HTTP ${metaRes.status}).`);
    const data = (await metaRes.json()) as {
      metadata?: {
        title?: string;
        creator?: string | string[];
        year?: number | string;
        language?: string;
      };
      files?: Array<{ name?: string; size?: number }>;
    };
    const meta = data.metadata ?? {};
    const files = data.files ?? [];
    const epub = files.find(
      (f): f is { name: string; size?: number } =>
        typeof f.name === "string" && f.name.toLowerCase().endsWith(".epub") && !f.name.toLowerCase().endsWith("_lcp.epub"),
    );
    if (!epub) throw new BookNotFoundError(`No usable EPUB file found in Archive.org item '${id}'.`);

    return {
      id,
      provider: this.name,
      title: meta.title || id,
      authors: meta.creator ? (Array.isArray(meta.creator) ? meta.creator : [meta.creator]) : [],
      year: parseYear(meta.year),
      language: meta.language,
      format: "epub",
      formats: ["epub"],
      mirrors: [
        {
          id,
          label: "Internet Archive Direct",
          kind: "direct" as const,
          url: `https://archive.org/download/${encodeURIComponent(id)}/${encodeURIComponent(epub.name)}`,
        },
      ],
      metadata: meta,
    };
  }

  async acquire(book: BookResult): Promise<AcquiredBook> {
    const details = await this.getBook(book.id);
    const mirror = details.mirrors.find((m) => m.url && (m.url.endsWith(".epub") || m.url.includes("/download/")));
    if (!mirror || !mirror.url) throw new BookNotFoundError(`No direct download link resolved for '${book.id}'.`);

    let currentUrl = mirror.url;
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(currentUrl);
    } catch {
      throw new ProviderUnavailableError("Invalid mirror URL", this.name);
    }
    const host = parsedUrl.hostname.toLowerCase();
    if (parsedUrl.protocol !== "https:" || (host !== "archive.org" && !host.endsWith(".archive.org"))) {
      throw new ProviderUnavailableError("Invalid Archive.org download destination", this.name);
    }

    const MAX_REDIRECTS = 5;
    let dlRes: Response | null = null;
    for (let hops = 0; hops <= MAX_REDIRECTS; hops++) {
      const res = await fetch(currentUrl, { signal: AbortSignal.timeout(30000), redirect: "manual" });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        await res.body?.cancel().catch(() => {});
        if (!location) throw new ProviderUnavailableError("Archive.org redirect missing Location header", this.name);
        try {
          const nextUrl = new URL(location, currentUrl);
          const nextHost = nextUrl.hostname.toLowerCase();
          if (nextUrl.protocol !== "https:" || (nextHost !== "archive.org" && !nextHost.endsWith(".archive.org"))) {
            throw new ProviderUnavailableError("Archive.org redirected to an untrusted destination", this.name);
          }
          currentUrl = nextUrl.toString();
        } catch (e) {
          if (e instanceof ProviderUnavailableError) throw e;
          throw new ProviderUnavailableError("Invalid Archive.org redirect target", this.name);
        }
        continue;
      }
      dlRes = res;
      break;
    }

    if (!dlRes) throw new ProviderUnavailableError("Archive.org download exceeded redirect limit", this.name);
    if (!dlRes.ok) throw new ProviderUnavailableError(`Archive.org download failed with HTTP ${dlRes.status}`, this.name);
    if (!dlRes.body) throw new ProviderUnavailableError("Empty response body from Archive.org", this.name);
    const buf = await readStreamWithCap(
      dlRes.body,
      TORRENT.MAX_FILE_SIZE_BYTES,
      () => new ProviderUnavailableError("Archive.org book exceeds maximum file size", this.name),
    );

    return {
      stream: new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array(buf));
          c.close();
        },
      }),
      filename: `${book.id}.epub`,
      contentType: "application/epub+zip",
      contentLength: buf.length,
    };
  }
}

/**
 * High-level helper that queries Archive.org and downloads the best matching EPUB.
 * Used as an automated fallback in ingestion when torrent/IPFS swarms are cold.
 */
export async function fetchEpubFromArchiveOrg(
  title: string,
  author?: string,
  onProgress?: (msg: string) => void,
): Promise<{ buffer: Buffer; filename: string } | null> {
  const provider = new ArchiveOrgProvider();
  try {
    onProgress?.(`Searching Internet Archive for "${title}"...`);
    const results = await provider.search({ title, author, limit: 5 });
    if (!results.length) return null;

    for (const result of results) {
      try {
        onProgress?.(`Attempting download of "${result.title}" from Internet Archive...`);
        const acquired = await provider.acquire(result);
        const chunks: Uint8Array[] = [];
        const reader = acquired.stream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) chunks.push(value);
        }
        const buffer = Buffer.concat(chunks);
        if (buffer.length > 5000 && isZipBuffer(buffer)) {
          onProgress?.(`✅ Downloaded "${result.title}" (${(buffer.length / 1024 / 1024).toFixed(2)} MB) from Internet Archive.`);
          return { buffer, filename: acquired.filename };
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`Archive.org item '${result.id}' failed to download: ${msg}`);
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`Archive.org search failed: ${msg}`);
  }
  return null;
}
