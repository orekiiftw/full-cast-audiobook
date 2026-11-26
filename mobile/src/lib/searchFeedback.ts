import { ApiError } from "@/api/client";

// A search can fail three ways that must never read the same: the request ran out of time, the
// server was never reached, or the server answered with an error. The web client's toast is a
// single string; the sheet shows a title and a detail so the reason is legible.

export type SearchFailureKind = "timeout" | "offline" | "rate-limited" | "session" | "server" | "unknown";

export interface SearchFailure {
  kind: SearchFailureKind;
  title: string;
  detail: string;
}

export function describeSearchFailure(error: unknown): SearchFailure {
  if (error instanceof ApiError) {
    if (error.timedOut) {
      return {
        kind: "timeout",
        title: "Search timed out",
        detail: "The sources are slow to answer. Try again — anything they already found is cached and comes back quickly.",
      };
    }
    if (error.isOffline) {
      return { kind: "offline", title: "Can't reach the server", detail: error.message };
    }
    if (error.status === 401) {
      return { kind: "session", title: "Session expired", detail: "Sign in again to keep searching." };
    }
    if (error.status === 429) {
      return { kind: "rate-limited", title: "Too many searches", detail: error.message };
    }
    if (error.status >= 400) {
      return { kind: "server", title: "The search failed", detail: error.message };
    }
    return { kind: "unknown", title: "Search failed", detail: error.message };
  }

  return {
    kind: "unknown",
    title: "Search failed",
    detail: error instanceof Error && error.message ? error.message : "Something went wrong. Try again.",
  };
}

export function describeAddFailure(error: unknown): SearchFailure {
  if (error instanceof ApiError) {
    if (error.timedOut) {
      return {
        kind: "timeout",
        title: "The add timed out",
        detail: "The server didn't answer in time. The book may already be queued — check the library before retrying.",
      };
    }
    if (error.isOffline) return { kind: "offline", title: "Can't reach the server", detail: error.message };
    if (error.status === 401) return { kind: "session", title: "Session expired", detail: "Sign in again to add books." };
    return { kind: "server", title: "Could not add this book", detail: error.message };
  }

  return { kind: "unknown", title: "Could not add this book", detail: "Something went wrong. Try again." };
}

const PROVIDER_LABELS: Record<string, string> = {
  "anna-archive": "Anna's Archive",
  "archive-org": "Internet Archive",
  gutenberg: "Project Gutenberg",
  libgen: "LibGen",
};

export function providerLabel(provider: string): string {
  const known = PROVIDER_LABELS[provider];
  if (known) return known;
  return provider
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export interface SearchNotice {
  title: string;
  detail: string;
}

// The server answers inside a fixed budget and names the providers still working. That is not an
// empty state — results may be right above the notice — so it gets its own copy.
export function partialNotice(pending: string[] | null | undefined): SearchNotice {
  const names = (pending ?? []).map(providerLabel);
  const who =
    names.length === 0 ? "Some sources" : names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return {
    title: "Some sources are still searching",
    detail:
      names.length === 0
        ? "These results came back inside the search budget; the rest arrive on a later search."
        : `${who} ${names.length === 1 ? "hasn't" : "haven't"} answered yet. Everything below came back inside the search budget.`,
  };
}

export function formatFormat(format: string): string {
  return format ? format.toUpperCase() : "UNKNOWN";
}

export function formatSize(bytes: number | undefined): string | null {
  if (!bytes || bytes <= 0) return null;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
