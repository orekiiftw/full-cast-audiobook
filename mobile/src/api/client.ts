import { API_BASE_URL } from "./config";
import type { ApiErrorBody } from "./types";

// ---------------------------------------------------------------------------------------
// Session token plumbing
// ---------------------------------------------------------------------------------------

let bearerToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setBearerToken(token: string | null): void {
  bearerToken = token;
}

export function getBearerToken(): string | null {
  return bearerToken;
}

// Fired for any 401 with a token attached: the session is dead and the app returns to Auth.
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export class ApiError extends Error {
  readonly status: number;
  // A request that ran out of its own time budget: no HTTP status, but not an unreachable server.
  readonly timedOut: boolean;

  constructor(status: number, message: string, options: { timedOut?: boolean } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.timedOut = options.timedOut ?? false;
  }

  get isOffline(): boolean {
    return this.status === 0 && !this.timedOut;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  // Auth endpoints must not report a 401 as an expired session: it means bad credentials.
  notifyOnUnauthorized?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  timeoutMessage?: string;
}

export const REQUEST_TIMEOUT_MS = 30_000;

// The server answers a search inside its own 15s budget, so this only fires when the request
// itself is stuck. It stays above the budget by design.
export const SEARCH_TIMEOUT_MS = 60_000;

export const TIMEOUT_MESSAGE = "The request is taking too long — try again.";

export const SEARCH_TIMEOUT_MESSAGE = "Search is taking too long — try again.";

// The only message that names the address: the request never reached the server at all.
export const UNREACHABLE_MESSAGE = `Can't reach the server at ${API_BASE_URL}. Check API_BASE_URL (EXPO_PUBLIC_API_BASE_URL) and that the server is running.`;

export function apiUrl(path: string): string {
  return path.startsWith("http") ? path : `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function apiFetch(path: string, options: RequestOptions = {}): Promise<Response> {
  const {
    method = "GET",
    body,
    notifyOnUnauthorized = true,
    signal,
    timeoutMs = REQUEST_TIMEOUT_MS,
    timeoutMessage = TIMEOUT_MESSAGE,
  } = options;
  const headers: Record<string, string> = { Accept: "application/json" };

  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const forwardAbort = () => controller.abort();
  signal?.addEventListener("abort", forwardAbort);

  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (timedOut) throw new ApiError(0, timeoutMessage, { timedOut: true });
    throw new ApiError(0, UNREACHABLE_MESSAGE);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forwardAbort);
  }

  if (response.status === 401 && notifyOnUnauthorized && bearerToken) {
    unauthorizedHandler?.();
  }

  return response;
}

export async function readError(response: Response, fallback = "Something went wrong. Please try again."): Promise<string> {
  try {
    const payload = (await response.json()) as ApiErrorBody;
    if (typeof payload?.error === "string" && payload.error.trim()) return payload.error.trim().slice(0, 240);
  } catch {
    // Fall through to the caller's fallback.
  }
  return fallback;
}

export async function apiJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await apiFetch(path, options);
  if (!response.ok) throw new ApiError(response.status, await readError(response));
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
