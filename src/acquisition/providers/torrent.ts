import { downloadBookFromTorrent, searchBookTorrent } from "../../torrent";
import { BookNotFoundError } from "../errors";
import { AcquiredBook, BookDetails, BookProvider, BookResult, SearchQuery } from "../types";
import { bufferToStream } from "./shared";

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
      stream: bufferToStream(result.buffer),
      filename: result.filename,
      contentType: "application/epub+zip",
      contentLength: result.buffer.length,
    };
  }
}
