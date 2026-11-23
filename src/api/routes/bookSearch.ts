import { bookProviders } from "../../acquisition";
import { BookFormat, SearchQuery } from "../../acquisition/types";
import { json } from "../response";
import { type RouteContext, type RouteTable } from "../route";
import { ValidationError, boundedString } from "../../lib/validators";
import { readJsonWithLimit } from "../body";
import { ACQUISITION } from "../../lib/constants";
import { createRateLimiter } from "../rateLimit";

const MAX_QUERY_LENGTH = 500;

const MAX_QUERY_FIELD_LENGTH = 32;

const MAX_RESULTS = 100;

const SEARCH_BODY_LIMIT_BYTES = 32 * 1024;

const SEARCH_WINDOW_MS = 15 * 60 * 1000;

const SEARCH_MAX_REQUESTS = 60;

const BOOK_FORMATS = new Set<string>(["epub", "pdf", "mobi", "azw3", "unknown"]);

export const searchRateLimited = createRateLimiter({ windowMs: SEARCH_WINDOW_MS, maxAttempts: SEARCH_MAX_REQUESTS });

export const bookSearchRoutes: RouteTable = {
  "POST /api/book-search": searchBooks,
  "GET /api/book-search/:provider/:providerBookId": getProviderBook,
};

async function searchBooks({ req, user }: RouteContext): Promise<Response> {
  if (searchRateLimited(user.id)) {
    return json({ error: "Too many book searches. Try again later." }, 429);
  }

  const body = await readJsonWithLimit<Record<string, unknown>>(req, SEARCH_BODY_LIMIT_BYTES);
  const query = readSearchQuery(body);
  if (!query.title && !query.author && !query.isbn) {
    throw new ValidationError("At least one of title, author, or isbn is required");
  }

  const provider = readProvider(body);
  const response = provider
    ? await bookProviders.search(provider, query)
    : { results: await bookProviders.searchAll(query), cache: "miss" as const };

  return json({ ...response, providers: bookProviders.enabled() });
}

async function getProviderBook({ user, params }: RouteContext): Promise<Response> {
  if (searchRateLimited(user.id)) {
    return json({ error: "Too many book lookups. Try again later." }, 429);
  }

  const provider = decodeURIComponent(params.provider);
  const providerBookId = decodeURIComponent(params.providerBookId);

  if (provider.length > ACQUISITION.MAX_PROVIDER_NAME_LENGTH) {
    throw new ValidationError(`provider must be ${ACQUISITION.MAX_PROVIDER_NAME_LENGTH} characters or fewer`);
  }
  if (providerBookId.length > ACQUISITION.MAX_PROVIDER_BOOK_ID_LENGTH) {
    throw new ValidationError(`book id must be ${ACQUISITION.MAX_PROVIDER_BOOK_ID_LENGTH} characters or fewer`);
  }

  return json(await bookProviders.getBook(provider, providerBookId));
}

function readSearchQuery(body: Record<string, unknown>): SearchQuery {
  return {
    title: boundedString(body.title, "title", MAX_QUERY_LENGTH),
    author: boundedString(body.author, "author", MAX_QUERY_LENGTH),
    isbn: boundedString(body.isbn, "isbn", MAX_QUERY_LENGTH),
    languages: readStrings(body.languages, "languages"),
    formats: readFormats(body.formats),
    limit: readLimit(body.limit),
  };
}

function readProvider(body: Record<string, unknown>): string | undefined {
  const provider = boundedString(body.provider, "provider", MAX_QUERY_LENGTH);
  if (provider && provider.length > ACQUISITION.MAX_PROVIDER_NAME_LENGTH) {
    throw new ValidationError(`provider must be ${ACQUISITION.MAX_PROVIDER_NAME_LENGTH} characters or fewer`);
  }
  return provider;
}

function readStrings(value: unknown, name: string): string[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.length > MAX_QUERY_FIELD_LENGTH)) {
    throw new ValidationError(`${name} must be an array of short strings`);
  }
  return value.map((entry) => entry.trim()).filter(Boolean);
}

function readFormats(value: unknown): BookFormat[] | undefined {
  const formats = readStrings(value, "formats");
  if (formats === undefined) return undefined;
  if (formats.some((format) => !BOOK_FORMATS.has(format))) {
    throw new ValidationError(`formats entries must be one of: ${[...BOOK_FORMATS].join(", ")}`);
  }
  return formats as BookFormat[];
}

function readLimit(value: unknown): number | undefined {
  const isValid = typeof value === "number" && Number.isInteger(value) && value > 0 && value <= MAX_RESULTS;
  return isValid ? (value as number) : undefined;
}
