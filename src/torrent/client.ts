import { fetchWithRedirectGuard, redirectFailureMessage, type RedirectGuard } from "../lib/redirectGuard";
import { readStreamWithCap } from "../lib/readStream";

export const MAIN_API_URL = "https://api.torbox.app/v1/api";
export const SEARCH_API_URL = (process.env.TORBOX_SEARCH_URL ?? "https://search-api.torbox.app").replace(/\/+$/, "");
export const SEARCH_API_HOST = new URL(SEARCH_API_URL).hostname;
export const TORBOX_API_HOSTS = ["api.torbox.app"];

export const API_TIMEOUT_MS = 30_000;
export const ERROR_TEXT_CAP = 64 * 1024;

const JSON_RESPONSE_CAP = 32 * 1024 * 1024;

export function torBoxApiKey(): string | undefined {
  return process.env.TORBOX_API_KEY;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function sanitizeLogText(value: string): string {
  return value.replace(/[\x00-\x1f\x7f]/g, " ");
}

export function errorResText(text: string): string {
  try {
    const parsed = JSON.parse(text) as { detail?: unknown; error?: unknown };
    const detail = parsed.detail ?? parsed.error;
    if (typeof detail === "string") return detail;
    if (detail != null) return JSON.stringify(detail);
    return text;
  } catch {
    return text;
  }
}

export async function readBodyText(response: Response, cap: number, what: string): Promise<string> {
  if (!response.body) throw new Error(`${what}: empty response body.`);
  const buffer = await readStreamWithCap(
    response.body,
    cap,
    () => new Error(`${what} response exceeded the ${Math.round(cap / (1024 * 1024))}MB size limit.`),
  );
  return buffer.toString("utf-8");
}

export async function readJson<T>(response: Response, what: string): Promise<T> {
  const text = await readBodyText(response, JSON_RESPONSE_CAP, what);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${what} returned invalid JSON.`);
  }
}

export async function fetchApiWithValidatedRedirects(
  initialUrl: string,
  allowedHosts: string[],
  request: { headers?: Record<string, string>; method?: string; body?: BodyInit; timeoutMs: number },
): Promise<Response> {
  return fetchWithRedirectGuard({
    url: initialUrl,
    timeoutMs: request.timeoutMs,
    guard: apiRedirectGuard(allowedHosts),
    headers: request.headers,
    method: request.method,
    body: request.body,
  });
}

function apiRedirectGuard(allowedHosts: string[]): RedirectGuard {
  return {
    approve: (target) => {
      if (target.protocol !== "https:") {
        throw new Error(`API redirect to insecure protocol: ${target.protocol}`);
      }
      if (!allowedHosts.some((host) => target.hostname === host || target.hostname.endsWith(`.${host}`))) {
        throw new Error(`API redirect to unapproved host: ${target.hostname}`);
      }
      return target;
    },
    fail: (failure) => new Error(redirectFailureMessage("API", failure)),
  };
}
