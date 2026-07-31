import { downloadBookFromTorrent, searchBookTorrent } from "../torboxService";
import { BookNotFoundError, ProviderUnavailableError } from "./errors";
import { AcquiredBook, BookDetails, BookProvider, BookResult, SearchQuery } from "./types";

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
    return [{ id: magnet, provider: this.name, title: query.title, authors: query.author ? [query.author] : [], format: "epub", mirrors: [{ id: "torbox", label: "TorBox", kind: "torrent", url: magnet }] }];
  }
  async getBook(id: string): Promise<BookDetails> {
    if (!id.startsWith("magnet:")) throw new BookNotFoundError("Invalid torrent book identifier.");
    return { id, provider: this.name, title: "Torrent EPUB", authors: [], format: "epub", formats: ["epub"], mirrors: [{ id: "torbox", label: "TorBox", kind: "torrent", url: id }], metadata: {} };
  }
  async acquire(book: BookResult): Promise<AcquiredBook> {
    const result = await downloadBookFromTorrent(book.id);
    return { stream: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(result.buffer)); c.close(); } }), filename: result.filename, contentType: "application/epub+zip", contentLength: result.buffer.length };
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
  async search(_query: SearchQuery): Promise<BookResult[]> { throw new ProviderUnavailableError("Anna's Archive adapter is not configured.", this.name); }
  async getBook(_id: string): Promise<BookDetails> { throw new ProviderUnavailableError("Anna's Archive adapter is not configured.", this.name); }
  async acquire(_book: BookResult): Promise<AcquiredBook> { throw new ProviderUnavailableError("Anna's Archive adapter is not configured.", this.name); }
}
