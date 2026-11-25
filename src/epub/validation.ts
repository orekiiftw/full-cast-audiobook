import { errorMessage } from "../lib/errors";
import { isZipBuffer } from "../lib/validators";
import { openEpubArchive } from "./archive";
import { readPackageDocument, resolvePackagePath, resolveReadingOrder } from "./opf";

export interface EpubDefect {
  detail: string;
}

const MARKUP_HEAD = /^<(!doctype|html|head|body|\?xml)/i;

const PDF_MAGIC = "%PDF";

// Gate a candidate before it is accepted as a book: the zip magic, then the archive's central directory and
// container/OPF/spine (via the same guards parseEpub uses), so a source that hands back a web page or a zip with
// no reading order is rejected here instead of surfacing as a spine exception three layers into the pipeline.
// Page text is not read, which is the expensive half of parseEpub and needs a buffer that already passed.
export function inspectEpub(buffer: Buffer): EpubDefect | null {
  if (!isZipBuffer(buffer)) return { detail: describeNonZip(buffer) };

  try {
    const entries = openEpubArchive(buffer);
    const packagePath = resolvePackagePath(entries);
    const packageDocument = readPackageDocument(entries, packagePath);
    resolveReadingOrder(packageDocument.document, packageDocument.directory);
    return null;
  } catch (error) {
    return { detail: errorMessage(error) };
  }
}

function describeNonZip(buffer: Buffer): string {
  if (buffer.length === 0) return "the download was empty";
  const head = buffer.subarray(0, 512).toString("utf-8").trimStart();
  if (head.startsWith(PDF_MAGIC)) return "the download was a PDF, not an EPUB";
  if (MARKUP_HEAD.test(head)) return "the download was a web page, not an EPUB";
  return "the download is not a ZIP archive, which every EPUB is";
}
