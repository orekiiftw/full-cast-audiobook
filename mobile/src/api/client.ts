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

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }

  get isOffline(): boolean {
    return this.status === 0;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  // Auth endpoints must not report a 401 as an expired session: it means bad credentials.
  notifyOnUnauthorized?: boolean;
  signal?: AbortSignal;
}

const REQUEST_TIMEOUT_MS = 30_000;

export function apiUrl(path: string): string {
  return path.startsWith("http") ? path : `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function apiFetch(path: string, options: RequestOptions = {}): Promise<Response> {
  const { method = "GET", body, notifyOnUnauthorized = true, signal } = options;
  const headers: Record<string, string> = { Accept: "application/json" };

  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  if (signal) signal.addEventListener("abort", () => controller.abort());

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
    throw new ApiError(0, "Network error. Check the connection and API address.");
  } finally {
    clearTimeout(timer);
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
