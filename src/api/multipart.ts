import { ValidationError } from "../lib/validators";

const CR = 0x0d;
const LF = 0x0a;
const DASH = 0x2d;
const SPACE = 0x20;
const TAB = 0x09;

const CRLF = Buffer.from("\r\n");
const HEADER_BLOCK_END = Buffer.from("\r\n\r\n");
const EMPTY = Buffer.alloc(0);

const MAX_PART_HEADER_BYTES = 16 * 1024;
const MAX_DELIMITER_LINE_BYTES = 1024;
const MAX_BOUNDARY_LENGTH = 70;

const BODY_TOO_LARGE = "Request body too large.";
const FIELD_TOO_LARGE = "Form field too large.";

const DISPOSITION_PARAM = /;\s*([^\s=;]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s;]*))/g;

export interface MultipartFormOptions {
  textFields: readonly string[];
  fileField: string;
  maxBodyBytes: number;
  maxFieldBytes: number;
  maxFileBytes: number;
  fileTooLarge: () => Error;
}

export interface MultipartForm {
  fields: Map<string, string>;
  file: Buffer | null;
}

interface PartSink {
  write(chunk: Buffer): void;
  end(): void;
}

const DISCARD: PartSink = { write() {}, end() {} };

export async function readMultipartForm(req: Request, options: MultipartFormOptions): Promise<MultipartForm> {
  const declaredBodyBytes = Number(req.headers.get("content-length") ?? 0);
  if (declaredBodyBytes > options.maxBodyBytes) {
    throw new ValidationError(BODY_TOO_LARGE);
  }

  const parser = new MultipartParser(
    multipartBoundary(req.headers.get("content-type") ?? ""),
    Number.isFinite(declaredBodyBytes) ? declaredBodyBytes : 0,
    options,
  );
  const reader = req.body?.getReader();
  if (reader) {
    let received = 0;
    let completed = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > options.maxBodyBytes) throw new ValidationError(BODY_TOO_LARGE);
        parser.write(value);
      }
      completed = true;
    } finally {
      if (!completed) await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  return parser.end();
}

function multipartBoundary(contentType: string): string {
  const match = /;\s*boundary=(?:"([^"]+)"|([^\s;]+))/i.exec(contentType);
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary || boundary.length > MAX_BOUNDARY_LENGTH) throw new Error("Missing or invalid multipart boundary.");
  return boundary;
}

class MultipartParser {
  private readonly delimiter: Buffer;
  private pending: Buffer = CRLF;
  private state: "preamble" | "delimiter" | "headers" | "body" | "epilogue" = "preamble";
  private part: PartSink = DISCARD;
  private fileClaimed = false;
  private readonly fields = new Map<string, string>();
  private file: Buffer | null = null;

  constructor(
    boundary: string,
    private readonly declaredBodyBytes: number,
    private readonly options: MultipartFormOptions,
  ) {
    this.delimiter = Buffer.from(`\r\n--${boundary}`);
  }

  write(chunk: Uint8Array): void {
    const bytes = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    this.pending = this.pending.length > 0 ? Buffer.concat([this.pending, bytes]) : bytes;
    while (this.step());
  }

  end(): MultipartForm {
    if (this.state !== "epilogue") throw new Error("Multipart body ended before its closing boundary.");
    return { fields: this.fields, file: this.file };
  }

  private step(): boolean {
    switch (this.state) {
      case "preamble":
        return this.skipPreamble();
      case "delimiter":
        return this.readDelimiterLine();
      case "headers":
        return this.readHeaders();
      case "body":
        return this.readBody();
      case "epilogue":
        this.pending = EMPTY;
        return false;
    }
  }

  private skipPreamble(): boolean {
    const index = this.pending.indexOf(this.delimiter);
    if (index < 0) {
      this.pending = this.pending.subarray(this.pending.length - this.partialDelimiterLength());
      return false;
    }
    this.pending = this.pending.subarray(index + this.delimiter.length);
    this.state = "delimiter";
    return true;
  }

  private readDelimiterLine(): boolean {
    if (this.pending.length < 2) return false;
    if (this.pending[0] === DASH && this.pending[1] === DASH) {
      this.state = "epilogue";
      return true;
    }
    const lineEnd = this.pending.indexOf(CRLF);
    if (lineEnd < 0) {
      if (this.pending.length > MAX_DELIMITER_LINE_BYTES) throw new Error("Malformed multipart delimiter.");
      return false;
    }
    if (!isTransportPadding(this.pending.subarray(0, lineEnd))) throw new Error("Malformed multipart delimiter.");
    this.pending = this.pending.subarray(lineEnd + CRLF.length);
    this.state = "headers";
    return true;
  }

  private readHeaders(): boolean {
    if (this.pending.length < 2) return false;
    let headerBlock = "";
    if (this.pending[0] === CR && this.pending[1] === LF) {
      this.pending = this.pending.subarray(CRLF.length);
    } else {
      const end = this.pending.indexOf(HEADER_BLOCK_END);
      if (end < 0 ? this.pending.length > MAX_PART_HEADER_BYTES : end > MAX_PART_HEADER_BYTES) {
        throw new Error("Multipart part headers too large.");
      }
      if (end < 0) return false;
      headerBlock = this.pending.subarray(0, end).toString("utf8");
      this.pending = this.pending.subarray(end + HEADER_BLOCK_END.length);
    }
    this.part = this.openPart(headerBlock);
    this.state = "body";
    return true;
  }

  private readBody(): boolean {
    const index = this.pending.indexOf(this.delimiter);
    if (index < 0) {
      const safeLength = this.pending.length - this.partialDelimiterLength();
      this.part.write(this.pending.subarray(0, safeLength));
      this.pending = this.pending.subarray(safeLength);
      return false;
    }
    this.part.write(this.pending.subarray(0, index));
    this.part.end();
    this.part = DISCARD;
    this.pending = this.pending.subarray(index + this.delimiter.length);
    this.state = "delimiter";
    return true;
  }

  private partialDelimiterLength(): number {
    for (let start = Math.max(0, this.pending.length - (this.delimiter.length - 1)); start < this.pending.length; start++) {
      if (this.pending[start] !== CR) continue;
      const tail = this.pending.subarray(start);
      if (tail.equals(this.delimiter.subarray(0, tail.length))) return tail.length;
    }
    return 0;
  }

  private openPart(headerBlock: string): PartSink {
    const disposition = contentDisposition(headerBlock);
    const name = disposition.get("name");
    if (name === undefined) return DISCARD;
    if (name === this.options.fileField && !this.fileClaimed) {
      this.fileClaimed = true;
      return disposition.has("filename") ? this.fileSink() : DISCARD;
    }
    if (this.options.textFields.includes(name) && !this.fields.has(name)) return this.textSink(name);
    return DISCARD;
  }

  private textSink(name: string): PartSink {
    const chunks: Buffer[] = [];
    let size = 0;
    return {
      write: (chunk) => {
        size += chunk.length;
        if (size > this.options.maxFieldBytes) throw new ValidationError(FIELD_TOO_LARGE);
        chunks.push(Buffer.from(chunk));
      },
      end: () => {
        this.fields.set(name, Buffer.concat(chunks).toString("utf8"));
      },
    };
  }

  private fileSink(): PartSink {
    let buffer: Buffer = EMPTY;
    let size = 0;
    return {
      write: (chunk) => {
        const needed = size + chunk.length;
        if (needed > this.options.maxFileBytes) throw this.options.fileTooLarge();
        if (needed > buffer.length) buffer = this.growFileBuffer(buffer, size, needed);
        chunk.copy(buffer, size);
        size = needed;
      },
      end: () => {
        this.file = buffer.subarray(0, size);
      },
    };
  }

  private growFileBuffer(current: Buffer, used: number, needed: number): Buffer {
    const capacity = Math.min(this.options.maxFileBytes, Math.max(needed, this.declaredBodyBytes, current.length * 2));
    const grown = Buffer.allocUnsafe(capacity);
    current.copy(grown, 0, 0, used);
    return grown;
  }
}

function isTransportPadding(bytes: Buffer): boolean {
  return bytes.every((byte) => byte === SPACE || byte === TAB);
}

function contentDisposition(headerBlock: string): Map<string, string> {
  const params = new Map<string, string>();
  for (const line of headerBlock.split("\r\n")) {
    const colon = line.indexOf(":");
    if (colon < 0 || line.slice(0, colon).trim().toLowerCase() !== "content-disposition") continue;
    for (const match of line.slice(colon + 1).matchAll(DISPOSITION_PARAM)) {
      const key = match[1].toLowerCase();
      if (!params.has(key)) params.set(key, match[2] !== undefined ? match[2].replace(/\\(.)/g, "$1") : match[3]);
    }
    break;
  }
  return params;
}
