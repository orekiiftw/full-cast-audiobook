import type { ApiError, AuthResponse, AuthUser } from "../types/api";

export const AUTH_EXPIRED_EVENT = "narratea:auth-expired";

interface ApiFetchOptions {
  notifyOnUnauthorized?: boolean;
}

type ShowToast = (message: string, tone?: "info" | "error") => void;

export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  { notifyOnUnauthorized = true }: ApiFetchOptions = {},
): Promise<Response> {
  const requestInit: RequestInit = {
    ...init,
    credentials: init.credentials ?? "same-origin",
    signal: init.signal ?? AbortSignal.timeout(30_000),
  };
  const response = await fetch(input, requestInit);

  if (response.status === 401 && notifyOnUnauthorized) {
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  }

  return response;
}

export function authUserFromResponse(payload: AuthResponse | AuthUser): AuthUser | null {
  const candidate = "user" in payload ? payload.user : payload;
  if (!candidate || typeof candidate.email !== "string" || !candidate.email.trim()) return null;
  return candidate;
}

export function reportNetworkError(err: unknown, showToast: ShowToast): void {
  console.error(err);
  showToast("Network error occurred.", "error");
}

export async function deleteBook(bookId: string, title: string, showToast: ShowToast): Promise<boolean> {
  if (!window.confirm(`Delete "${title}" from your library?`)) return false;
  try {
    const res = await apiFetch(`/api/books/${bookId}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await readErrorPayload(res);
      showToast(body?.error || "Failed to delete book.", "error");
      return false;
    }
    showToast("Book deleted.");
    return true;
  } catch (err) {
    reportNetworkError(err, showToast);
    return false;
  }
}

export async function safeApiError(response: Response, fallback = "Something went wrong. Please try again."): Promise<string> {
  const payload = await readErrorPayload(response);
  if (typeof payload?.error !== "string") return fallback;
  const message = payload.error.replace(/[<>]/g, "").trim();
  return message ? message.slice(0, 240) : fallback;
}

async function readErrorPayload(response: Response): Promise<Partial<ApiError> | null> {
  try {
    return (await response.json()) as Partial<ApiError>;
  } catch {
    return null;
  }
}
