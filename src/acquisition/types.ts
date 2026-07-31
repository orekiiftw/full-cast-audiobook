export type BookFormat = "epub" | "pdf" | "mobi" | "azw3" | "unknown";

export interface SearchQuery {
  title?: string;
  author?: string;
  isbn?: string;
  languages?: string[];
  formats?: BookFormat[];
  limit?: number;
}

export interface BookMirror {
  id: string;
  label: string;
  url?: string;
  kind: "direct" | "torrent" | "ipfs" | "partner" | "unknown";
}

export interface BookResult {
  id: string;
  provider: string;
  title: string;
  subtitle?: string;
  authors: string[];
  language?: string;
  publisher?: string;
  year?: number;
  isbn?: string;
  format: BookFormat;
  filesize?: number;
  cover?: string;
  rating?: number;
  mirrors: BookMirror[];
  /** Configurable ranking score; absent before the registry ranks a result. */
  score?: number;
}

export interface BookDetails extends BookResult {
  description?: string;
  formats: BookFormat[];
  metadata: Record<string, unknown>;
}

export interface AcquiredBook {
  stream: ReadableStream<Uint8Array>;
  filename: string;
  contentType?: string;
  contentLength?: number;
  expectedSha256?: string;
}

export interface BookProvider {
  readonly name: string;
  search(query: SearchQuery): Promise<BookResult[]>;
  getBook(id: string): Promise<BookDetails>;
  acquire(book: BookResult): Promise<AcquiredBook>;
}

export interface ProviderSearchResponse {
  results: BookResult[];
  cache: "hit" | "miss";
}
