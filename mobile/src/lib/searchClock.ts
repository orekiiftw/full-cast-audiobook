import { providerLabel } from "@/lib/searchFeedback";

// `POST /api/book-search` answered in 13.3s against the live server with healthy providers,
// and the slowest one is a torrent sweep that alone takes 12.4s. A search button that spins
// for thirteen seconds reads as a hang, so the sheet shows what is happening instead: how long
// it has been, and which sources have answered. The route is a single request, so "answered"
// can only be resolved when it returns — the clock and the source roster are what make the wait
// legible, and the `pending` list then names whoever was still working.

// The providers the route can consult. Used for the roster while a first search has no answer
// to read yet; afterwards the response's own `providers` wins.
export const SEARCH_SOURCES = ["anna-archive", "archive-org", "gutenberg", "libgen"];

export interface SourceAnswer {
  provider: string;
  label: string;
  answered: boolean;
}

export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest.toString().padStart(2, "0")}s`;
}

// `pending` is null for a complete answer (every source replied) and named list otherwise.
export function sourceAnswers(roster: string[] | null | undefined, pending: string[] | null | undefined): SourceAnswer[] {
  const names = roster && roster.length > 0 ? roster : SEARCH_SOURCES;
  const waiting = new Set(pending ?? []);
  return names.map((provider) => ({
    provider,
    label: providerLabel(provider),
    answered: waiting.size === 0 ? true : !waiting.has(provider),
  }));
}

// The in-flight line: the copy has to move while nothing else on screen does.
export function searchProgressLine(elapsedMs: number, answeredCount: number, sourceCount: number): string {
  const clock = formatElapsed(elapsedMs);
  if (sourceCount > 0 && answeredCount > 0) {
    return `Still searching · ${clock} · ${answeredCount} of ${sourceCount} sources in`;
  }
  return `Still searching · ${clock} · asking ${sourceCount || SEARCH_SOURCES.length} sources`;
}
