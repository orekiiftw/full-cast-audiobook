import { BookResult, SearchQuery } from "./types";

export interface RankingConfig {
  preferredLanguages: string[];
  preferredFormats: string[];
  weights: {
    isbnExact: number;
    titleExact: number;
    titleToken: number;
    authorToken: number;
    language: number;
    format: number;
    filesize: number;
  };
}

export const defaultRankingConfig: RankingConfig = {
  preferredLanguages: (process.env.PREFERRED_LANGUAGES ?? "en").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean),
  preferredFormats: (process.env.PREFERRED_FORMATS ?? "epub").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean),
  weights: { isbnExact: 1000, titleExact: 180, titleToken: 18, authorToken: 12, language: 25, format: 40, filesize: 10 },
};

function normalized(value?: string): string {
  return (value ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
function tokens(value?: string): string[] { return normalized(value).split(" ").filter((x) => x.length > 1); }

export function scoreBook(result: BookResult, query: SearchQuery, config = defaultRankingConfig): number {
  let score = 0;
  const resultTitle = normalized(`${result.title} ${result.subtitle ?? ""}`);
  const queryTitle = normalized(query.title);
  if (query.isbn && result.isbn && normalized(query.isbn).replace(/ /g, "") === normalized(result.isbn).replace(/ /g, "")) score += config.weights.isbnExact;
  if (queryTitle && resultTitle === queryTitle) score += config.weights.titleExact;
  for (const token of tokens(query.title)) if (resultTitle.includes(token)) score += config.weights.titleToken;
  const resultAuthors = result.authors.join(" ");
  for (const token of tokens(query.author)) if (normalized(resultAuthors).includes(token)) score += config.weights.authorToken;
  const languages = query.languages?.length ? query.languages : config.preferredLanguages;
  if (result.language && languages.map(normalized).includes(normalized(result.language))) score += config.weights.language;
  const formats = query.formats?.length ? query.formats : config.preferredFormats;
  const formatIndex = formats.map(String).map(normalized).indexOf(normalized(result.format));
  if (formatIndex >= 0) score += Math.max(1, config.weights.format - formatIndex * 5);
  if (result.filesize && result.filesize > 10_000 && result.filesize < 100 * 1024 * 1024) score += config.weights.filesize;
  return score;
}

export function rankBooks(results: BookResult[], query: SearchQuery, config = defaultRankingConfig): BookResult[] {
  return results.map((result) => ({ ...result, score: scoreBook(result, query, config) }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.title.localeCompare(b.title));
}

export function normalizeSearchQuery(query: SearchQuery): string {
  return JSON.stringify({ title: normalized(query.title), author: normalized(query.author), isbn: normalized(query.isbn), languages: [...(query.languages ?? [])].map(normalized).sort(), formats: [...(query.formats ?? [])].map(normalized).sort(), limit: query.limit ?? null });
}
