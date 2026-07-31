import { bookProviders } from "../../acquisition";
import { BookFormat, SearchQuery } from "../../acquisition/types";
import { json } from "../response";
import { boundedString, readJsonWithLimit, ValidationError } from "../../lib/validators";
import { AuthUser } from "../../auth";

const SEARCH_PATH = "/api/book-search";
const DETAIL_RE = /^\/api\/book-search\/([^/]+)\/([^/]+)$/;
const MAX_QUERY_LENGTH = 500;
/** Provider identifiers are short enum-ish names; bound generously. */
const MAX_PROVIDER_LENGTH = 64;
/**
 * Provider book IDs vary (info-hashes, magnet URIs, catalogue IDs). A magnet
 * URI is the longest realistic value (~2KB); cap well above that and reject
 * anything larger before it can upsert an unbounded book_metadata row.
 */
const MAX_PROVIDER_BOOK_ID_LENGTH = 4096;

const string = (value: unknown, name: string) => boundedString(value, name, MAX_QUERY_LENGTH);
function strings(value: unknown, name: string): string[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value) || value.some((x) => typeof x !== "string" || x.length > 32)) throw new ValidationError(`${name} must be an array of short strings`);
  return value.map((x) => x.trim()).filter(Boolean);
}

export async function registerBookSearchRoutes(req: Request, path: string, _user: AuthUser): Promise<Response | null> {
  if (path === SEARCH_PATH && req.method === "POST") {
    const body = await readJsonWithLimit<Record<string, unknown>>(req, 32 * 1024);
    const query: SearchQuery = { title: string(body.title, "title"), author: string(body.author, "author"), isbn: string(body.isbn, "isbn"), languages: strings(body.languages, "languages"), formats: strings(body.formats, "formats") as BookFormat[] | undefined, limit: typeof body.limit === "number" && Number.isInteger(body.limit) && body.limit > 0 && body.limit <= 100 ? body.limit : undefined };
    if (!query.title && !query.author && !query.isbn) throw new ValidationError("At least one of title, author, or isbn is required");
    const provider = string(body.provider, "provider");
    const response = provider ? await bookProviders.search(provider, query) : { results: await bookProviders.searchAll(query), cache: "miss" as const };
    return json({ ...response, providers: bookProviders.enabled() });
  }
  const detail = path.match(DETAIL_RE);
  if (detail && req.method === "GET") {
    const provider = decodeURIComponent(detail[1]);
    const providerBookId = decodeURIComponent(detail[2]);
    // Bound both segments: a pathologically long ID upserts a book_metadata
    // row per unique value (slow, unbounded DB growth). Reject before lookup.
    if (provider.length > MAX_PROVIDER_LENGTH) {
      throw new ValidationError(`provider must be ${MAX_PROVIDER_LENGTH} characters or fewer`);
    }
    if (providerBookId.length > MAX_PROVIDER_BOOK_ID_LENGTH) {
      throw new ValidationError(`book id must be ${MAX_PROVIDER_BOOK_ID_LENGTH} characters or fewer`);
    }
    return json(await bookProviders.getBook(provider, providerBookId));
  }
  return null;
}
