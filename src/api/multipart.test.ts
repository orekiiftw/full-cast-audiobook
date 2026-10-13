import { describe, expect, it } from "bun:test";
import { ValidationError } from "../lib/validators";
import { readMultipartForm, type MultipartFormOptions } from "./multipart";

const OPTIONS: MultipartFormOptions = {
  textFields: ["title", "author", "magnet"],
  fileField: "file",
  maxBodyBytes: 4096,
  maxFieldBytes: 64,
  maxFileBytes: 1024,
  fileTooLarge: () => new ValidationError("file too large"),
};

const BOUNDARY = "narratea-test-boundary";
const CONTENT_TYPE = `multipart/form-data; boundary=${BOUNDARY}`;

function epubLike(size: number): Buffer {
  const bytes = Buffer.alloc(size);
  bytes.writeUInt32LE(0x04034b50, 0);
  for (let i = 4; i < size; i++) bytes[i] = (i * 31) % 256;
  return bytes;
}

async function serialize(entries: Record<string, string | File>): Promise<{ raw: Buffer; contentType: string }> {
  const form = new FormData();
  for (const [name, value] of Object.entries(entries)) form.append(name, value);
  const req = new Request("http://localhost/upload", { method: "POST", body: form });
  const contentType = req.headers.get("content-type") ?? "";
  return { raw: Buffer.from(await req.arrayBuffer()), contentType };
}

function streamRequest(chunks: Uint8Array[], contentType = CONTENT_TYPE, headers: Record<string, string> = {}): Request {
  let next = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (next < chunks.length) controller.enqueue(chunks[next++]);
      else controller.close();
    },
  });
  return new Request("http://localhost/upload", { method: "POST", headers: { "Content-Type": contentType, ...headers }, body });
}

function chunked(raw: Buffer, size: number): Buffer[] {
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < raw.length; offset += size) chunks.push(raw.subarray(offset, offset + size));
  return chunks;
}

function rawBody(text: string): Buffer {
  return Buffer.from(text.replaceAll("\n", "\r\n"));
}

describe("readMultipartForm", () => {
  it("reads FormData text fields and the file bytes", async () => {
    const epub = epubLike(300);
    const { raw, contentType } = await serialize({
      title: " Dune ",
      author: "Frank Herbert",
      file: new File([new Uint8Array(epub)], "dune.epub", { type: "application/epub+zip" }),
    });

    const form = await readMultipartForm(streamRequest([raw], contentType), OPTIONS);

    expect(form.fields.get("title")).toBe(" Dune ");
    expect(form.fields.get("author")).toBe("Frank Herbert");
    expect(form.fields.has("magnet")).toBe(false);
    expect(form.file?.equals(epub)).toBe(true);
  });

  it("returns the same form for every way the body can be split into chunks", async () => {
    const epub = epubLike(200);
    const { raw, contentType } = await serialize({
      title: "Ébauche “Ω”",
      file: new File([new Uint8Array(epub)], "x.epub"),
      magnet: "abc",
    });

    const splits = [chunked(raw, 1), chunked(raw, 7)];
    for (let at = 1; at < raw.length; at++) splits.push([raw.subarray(0, at), raw.subarray(at)]);

    for (const chunks of splits) {
      const form = await readMultipartForm(streamRequest(chunks, contentType), OPTIONS);
      expect(form.fields.get("title")).toBe("Ébauche “Ω”");
      expect(form.fields.get("magnet")).toBe("abc");
      expect(form.file?.equals(epub)).toBe(true);
    }
  });

  it("tolerates a preamble, transport padding, an empty header block, an epilogue and a quoted boundary", async () => {
    const raw = rawBody(
      [
        "preamble text that is ignored",
        `--${BOUNDARY}  `,
        'Content-Disposition: form-data; name="title"',
        "",
        "Kindred",
        `--${BOUNDARY}`,
        "",
        "part without headers",
        `--${BOUNDARY}`,
        'content-disposition: form-data; name=author; filename="a.txt"',
        "Content-Type: text/plain",
        "",
        "Octavia E. Butler",
        `--${BOUNDARY}--`,
        "epilogue text that is ignored",
      ].join("\n"),
    );

    const form = await readMultipartForm(streamRequest(chunked(raw, 5), `multipart/form-data; boundary="${BOUNDARY}"`), OPTIONS);

    expect(Object.fromEntries(form.fields)).toEqual({ title: "Kindred", author: "Octavia E. Butler" });
    expect(form.file).toBeNull();
  });

  it("keeps the first value of a repeated field and ignores parts it was not asked for", async () => {
    const raw = rawBody(
      [
        `--${BOUNDARY}`,
        'Content-Disposition: form-data; name="title"',
        "",
        "first",
        `--${BOUNDARY}`,
        'Content-Disposition: form-data; name="title"',
        "",
        "second",
        `--${BOUNDARY}`,
        'Content-Disposition: form-data; name="unexpected"',
        "",
        "x".repeat(500),
        `--${BOUNDARY}--`,
        "",
      ].join("\n"),
    );

    const form = await readMultipartForm(streamRequest([raw]), OPTIONS);

    expect(Object.fromEntries(form.fields)).toEqual({ title: "first" });
  });

  it("uses only the first part named file, and only when it is a file", async () => {
    const { raw, contentType } = await serialize({ file: "not a file", title: "t" });
    const textFirst = new FormData();
    textFirst.append("file", "not a file");
    textFirst.append("file", new File([new Uint8Array(epubLike(10))], "late.epub"));
    const textFirstReq = new Request("http://localhost/upload", { method: "POST", body: textFirst });

    expect((await readMultipartForm(streamRequest([raw], contentType), OPTIONS)).file).toBeNull();
    expect((await readMultipartForm(textFirstReq, OPTIONS)).file).toBeNull();
  });

  it("assembles a file larger than one chunk and sizes its buffer from the declared length", async () => {
    const epub = epubLike(100_000);
    const { raw, contentType } = await serialize({ file: new File([new Uint8Array(epub)], "big.epub") });
    const options = { ...OPTIONS, maxBodyBytes: 1_000_000, maxFileBytes: 500_000 };

    const undeclared = await readMultipartForm(streamRequest(chunked(raw, 3_001), contentType), options);
    const declared = await readMultipartForm(
      streamRequest(chunked(raw, 3_001), contentType, { "Content-Length": String(raw.length) }),
      options,
    );

    expect(undeclared.file?.equals(epub)).toBe(true);
    expect(declared.file?.equals(epub)).toBe(true);
    expect(declared.file?.buffer.byteLength).toBeLessThanOrEqual(raw.length);
  });

  it("returns an empty file for an empty file input", async () => {
    const { raw, contentType } = await serialize({ file: new File([], "") });

    const form = await readMultipartForm(streamRequest([raw], contentType), OPTIONS);

    expect(form.file?.length).toBe(0);
  });

  it("rejects bodies without a boundary, without a closing delimiter, or with broken framing", async () => {
    const valid = rawBody([`--${BOUNDARY}`, 'Content-Disposition: form-data; name="title"', "", "t", `--${BOUNDARY}--`, ""].join("\n"));
    const brokenDelimiter = rawBody([`--${BOUNDARY}junk`, 'Content-Disposition: form-data; name="title"', "", "t"].join("\n"));
    const hugeHeaders = Buffer.concat([rawBody(`--${BOUNDARY}\nX-Filler: `), Buffer.alloc(20_000, "a")]);

    expect((await readMultipartForm(streamRequest([valid]), OPTIONS)).fields.get("title")).toBe("t");
    await expect(readMultipartForm(streamRequest([valid], "multipart/form-data"), OPTIONS)).rejects.toThrow("boundary");
    await expect(readMultipartForm(streamRequest([valid.subarray(0, valid.length - 10)]), OPTIONS)).rejects.toThrow("closing");
    await expect(readMultipartForm(streamRequest([]), OPTIONS)).rejects.toThrow("closing");
    await expect(readMultipartForm(streamRequest([brokenDelimiter]), OPTIONS)).rejects.toThrow("delimiter");
    await expect(readMultipartForm(streamRequest([hugeHeaders]), { ...OPTIONS, maxBodyBytes: 50_000 })).rejects.toThrow("headers");
  });

  it("stops reading as soon as the file passes its cap", async () => {
    const header = rawBody(`--${BOUNDARY}\nContent-Disposition: form-data; name="file"; filename="big.epub"\n\n`);
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(pulled === 1 ? header : Buffer.alloc(256, 0x61));
      },
    });
    const req = new Request("http://localhost/upload", { method: "POST", headers: { "Content-Type": CONTENT_TYPE }, body });

    await expect(readMultipartForm(req, { ...OPTIONS, maxBodyBytes: 1_000_000 })).rejects.toThrow("file too large");
    expect(pulled).toBeLessThan(10);
  });

  it("stops reading as soon as the body passes its cap, and checks a declared length before reading", async () => {
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(Buffer.alloc(512, 0x61));
      },
    });
    const req = new Request("http://localhost/upload", { method: "POST", headers: { "Content-Type": CONTENT_TYPE }, body: endless });

    await expect(readMultipartForm(req, OPTIONS)).rejects.toThrow("Request body too large.");
    expect(pulled).toBeLessThan(12);

    const declared = streamRequest([Buffer.alloc(10)], CONTENT_TYPE, { "Content-Length": String(OPTIONS.maxBodyBytes + 1) });
    await expect(readMultipartForm(declared, OPTIONS)).rejects.toThrow("Request body too large.");
  });

  it("caps text fields", async () => {
    const { raw, contentType } = await serialize({ title: "t".repeat(OPTIONS.maxFieldBytes + 1) });

    await expect(readMultipartForm(streamRequest([raw], contentType), OPTIONS)).rejects.toThrow("Form field too large.");
  });
});
