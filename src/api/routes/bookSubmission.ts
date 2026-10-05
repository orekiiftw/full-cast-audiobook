import { ACQUISITION } from "../../lib/constants";
import { ValidationError, isZipBuffer } from "../../lib/validators";
import type { BookSubmission } from "../../books/submission";
import { readBodyWithLimit, readJsonWithLimit } from "../body";

const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;

const MAX_MULTIPART_BODY_BYTES = MAX_UPLOAD_BYTES + 1024 * 1024;

export async function readBookSubmission(req: Request): Promise<BookSubmission> {
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    return readMultipartSubmission(req);
  }
  return readJsonSubmission(req);
}

async function readMultipartSubmission(req: Request): Promise<BookSubmission> {
  const submission: BookSubmission = { title: "", author: "", magnetOrHash: "" };

  try {
    const bodyBuffer = await readBodyWithLimit(req, MAX_MULTIPART_BODY_BYTES);
    const formData = await readFormData(req, bodyBuffer);

    submission.title = readFormField(formData, "title");
    submission.author = readFormField(formData, "author");
    submission.magnetOrHash = readFormField(formData, "magnet");

    const file = formData.get("file");
    if (!(file instanceof Blob) || file.size === 0) {
      return submission;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new ValidationError(`EPUB exceeds maximum upload size of ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB`);
    }

    const epubBuffer = Buffer.from(await file.arrayBuffer());
    if (!isZipBuffer(epubBuffer)) {
      throw new ValidationError("The uploaded file is not a valid EPUB (ZIP) archive.");
    }
    submission.epubBuffer = epubBuffer;
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError("Malformed multipart request body.");
  }

  return submission;
}

function readFormData(req: Request, bodyBuffer: Buffer): Promise<FormData> {
  const formRequest = new Request("http://localhost/upload", {
    method: "POST",
    headers: Object.fromEntries(Array.from(req.headers.entries()).filter(([key]) => key.toLowerCase() === "content-type")),
    body: new Uint8Array(bodyBuffer),
  });
  return formRequest.formData();
}

async function readJsonSubmission(req: Request): Promise<BookSubmission> {
  const body = (await readJsonWithLimit(req)) as Record<string, unknown>;
  const submission: BookSubmission = {
    title: String(body.title ?? "").trim(),
    author: String(body.author ?? "").trim(),
    magnetOrHash: String(body.magnet ?? "").trim(),
  };

  if (body.providerBook && typeof body.providerBook === "object" && !Array.isArray(body.providerBook)) {
    submission.requestedProviderBook = readProviderBookRef(body.providerBook as Record<string, unknown>);
  }

  return submission;
}

interface ProviderBookRef {
  provider: string;
  id: string;
}

function readProviderBookRef(requested: Record<string, unknown>): ProviderBookRef {
  if (
    typeof requested.id !== "string" ||
    typeof requested.provider !== "string" ||
    typeof requested.title !== "string" ||
    !Array.isArray(requested.authors) ||
    typeof requested.format !== "string"
  ) {
    throw new ValidationError("providerBook is malformed");
  }
  if (requested.provider.length > ACQUISITION.MAX_PROVIDER_NAME_LENGTH) {
    throw new ValidationError(`provider must be ${ACQUISITION.MAX_PROVIDER_NAME_LENGTH} characters or fewer`);
  }
  if (requested.id.length > ACQUISITION.MAX_PROVIDER_BOOK_ID_LENGTH) {
    throw new ValidationError(`book id must be ${ACQUISITION.MAX_PROVIDER_BOOK_ID_LENGTH} characters or fewer`);
  }
  return { provider: requested.provider, id: requested.id };
}

function readFormField(formData: FormData, key: string): string {
  return ((formData.get(key) as string) ?? "").trim();
}
