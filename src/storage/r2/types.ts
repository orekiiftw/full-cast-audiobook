export interface FileStat {
  size: number;
}

export interface StreamRange {
  start: number;
  end: number;
}

export interface StreamResult {
  stream: ReadableStream<Uint8Array>;
  length: number;
  totalSize: number;
  partial: boolean;
}
