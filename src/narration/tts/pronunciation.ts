const compiledDictionaryCache = new WeakMap<Record<string, string>, Array<{ regex: RegExp; hint: string }>>();

function compileDictionary(dictionary: Record<string, string>): Array<{ regex: RegExp; hint: string }> {
  const cached = compiledDictionaryCache.get(dictionary);
  if (cached) return cached;

  const compiled = Object.entries(dictionary).map(([term, hint]) => ({
    regex: new RegExp(`(?<![\\w])${term.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")}(?![\\w])`, "gi"),
    hint: hint.replace(/\$/g, "$$$$"),
  }));
  compiledDictionaryCache.set(dictionary, compiled);
  return compiled;
}

export function applyPronunciationDict(text: string, dictionary?: Record<string, string>): string {
  if (!dictionary) return text;
  let processed = text;
  for (const { regex, hint } of compileDictionary(dictionary)) {
    processed = processed.replace(regex, hint);
  }
  return processed;
}
