import { ACQUISITION } from "../../lib/constants";
import { ValidationError, isZipBuffer } from "../../lib/validators";
import type { BookSubmission } from "../../books/submission";
import { readJsonWithLimit } from "../body";
import { readMultipartForm } from "../multipart";

const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;

const MAX_MULTIPART_BODY_BYTES = MAX_UPLOAD_BYTES + 1024 * 1024;

const MAX_FORM_FIELD_BYTES = 64 * 1024;

export function isMultipartRequest(req: Request): boolean {
  return (req.headers.get("content-type") ?? "").includes("multipart/form-data");
}

export async function readBookSubmission(req: Request): Promise<BookSubmission> {
  return isMultipartRequest(req) ? readMultipartSubmission(req) : readJsonSubmission(req);
}

async function readMultipartSubmission(req: Request): Promise<BookSubmission> {
  try {
    const form = await readMultipartForm(req, {
      textFields: ["title", "author", "magnet"],
      fileField: "file",
      maxBodyBytes: MAX_MULTIPART_BODY_BYTES,
      maxFieldBytes: MAX_FORM_FIELD_BYTES,
      maxFileBytes: MAX_UPLOAD_BYTES,
      fileTooLarge: () => new ValidationError(`EPUB exceeds maximum upload size of ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB`),
    });
    const submission: BookSubmission = {
      title: (form.fields.get("title") ?? "").trim(),
      author: (form.fields.get("author") ?? "").trim(),
      magnetOrHash: (form.fields.get("magnet") ?? "").trim(),
    };

    if (!form.file || form.file.length === 0) return submission;
    if (!isZipBuffer(form.file)) {
      throw new ValidationError("The uploaded file is not a valid EPUB (ZIP) archive.");
    }
    submission.epubBuffer = form.file;
    return submission;
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError("Malformed multipart request body.");
  }
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
