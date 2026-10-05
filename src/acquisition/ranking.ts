import { ISO_639_2_TO_1 } from "./languageCodes";
import { BookResult, SearchQuery } from "./types";

interface RankingConfig {
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

const defaultRankingConfig: RankingConfig = {
  preferredLanguages: (process.env.PREFERRED_LANGUAGES ?? "en")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
  preferredFormats: (process.env.PREFERRED_FORMATS ?? "epub")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
  weights: { isbnExact: 1000, titleExact: 180, titleToken: 18, authorToken: 12, language: 25, format: 40, filesize: 10 },
};

const TOKEN_STOPWORDS = new Set(["the", "and", "for", "with", "a", "an", "of", "to", "in", "on", "at", "by", "or", "as", "is"]);

export function scoreBook(result: BookResult, query: SearchQuery, config = defaultRankingConfig): number {
  let score = 0;
  const resultTitle = normalized(`${result.title} ${result.subtitle ?? ""}`);
  const queryTitle = normalized(query.title);
  if (query.isbn && result.isbn && isbnKey(query.isbn) === isbnKey(result.isbn)) score += config.weights.isbnExact;
  if (queryTitle && resultTitle === queryTitle) score += config.weights.titleExact;

  const resultTitleWords = new Set(resultTitle.split(" "));
  for (const token of tokens(query.title)) {
    if (TOKEN_STOPWORDS.has(token)) continue;
    if (resultTitleWords.has(token)) score += config.weights.titleToken;
  }

  const resultAuthorWords = new Set(normalized((result.authors ?? []).join(" ")).split(" "));
  for (const token of tokens(query.author)) {
    if (TOKEN_STOPWORDS.has(token)) continue;
    if (resultAuthorWords.has(token)) score += config.weights.authorToken;
  }

  const languages = query.languages?.length ? query.languages : config.preferredLanguages;
  if (result.language && languages.map(languageKey).includes(languageKey(result.language))) score += config.weights.language;

  const formats = query.formats?.length ? query.formats : config.preferredFormats;
  const formatIndex = formats.map(String).map(normalized).indexOf(normalized(result.format));
  if (formatIndex >= 0) score += Math.max(1, config.weights.format - formatIndex * 5);

  if (result.filesize && result.filesize > 10_000 && result.filesize < 100 * 1024 * 1024) score += config.weights.filesize;
  return score;
}

export function rankBooks(results: BookResult[], query: SearchQuery, config = defaultRankingConfig): BookResult[] {
  const languages = query.languages?.length ? query.languages : config.preferredLanguages;
  const preferred = new Set(languages.map(languageKey).filter(Boolean));
  const matchesPreferred = (result: BookResult): boolean => {
    const key = languageKey(result.language);
    return !!key && preferred.has(key);
  };

  return results
    .map((result) => ({ ...result, score: scoreBook(result, query, config) }))
    .sort(
      (a, b) =>
        Number(matchesPreferred(b)) - Number(matchesPreferred(a)) || (b.score ?? 0) - (a.score ?? 0) || a.title.localeCompare(b.title),
    )
    .filter((result, index, sorted) => {
      if (!result.isbn) return true;
      const key = isbnKey(result.isbn);
      return sorted.findIndex((other) => !!other.isbn && isbnKey(other.isbn) === key) === index;
    });
}

export function normalizeSearchQuery(query: SearchQuery): string {
  return JSON.stringify({
    title: normalized(query.title),
    author: normalized(query.author),
    isbn: normalized(query.isbn),
    languages: [...(query.languages ?? [])].map(normalized).sort(),
    formats: [...(query.formats ?? [])].map(normalized).sort(),
    limit: query.limit ?? null,
  });
}

function normalized(value?: string): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();
}

function tokens(value?: string): string[] {
  return normalized(value)
    .split(" ")
    .filter((token) => token.length > 1);
}

function languageKey(value?: string): string {
  const key = normalized(value);
  return ISO_639_2_TO_1[key] ?? key;
}

function isbnKey(value?: string): string {
  return normalized(value).replace(/ /g, "");
}
