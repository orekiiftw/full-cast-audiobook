import type { ApiError, AuthResponse, AuthUser } from "../types/api";

export const AUTH_EXPIRED_EVENT = "narratea:auth-expired";

interface ApiFetchOptions {
  notifyOnUnauthorized?: boolean;
}

/**
 * Same-origin API wrapper. Cookies are included explicitly and any protected
 * request that loses its session tells the root auth gate to reset the app.
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  { notifyOnUnauthorized = true }: ApiFetchOptions = {}
): Promise<Response> {
  const requestInit: RequestInit = {
    ...init,
    credentials: init.credentials ?? "same-origin",
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

type ShowToast = (message: string, tone?: "info" | "error") => void;

/** Standard handling for catch blocks around apiFetch: log for the console, toast for the user. */
export function reportNetworkError(err: unknown, showToast: ShowToast): void {
  console.error(err);
  showToast("Network error occurred.", "error");
}

/**
 * Confirm + DELETE /api/books/:id + toast, shared by the library card and the
 * detail view. Resolves true only when the book was actually deleted.
 */
export async function deleteBook(bookId: string, title: string, showToast: ShowToast): Promise<boolean> {
  if (!window.confirm(`Delete "${title}" from your library?`)) return false;
  try {
    const res = await apiFetch(`/api/books/${bookId}`, { method: "DELETE" });
    if (!res.ok) {
      const body = (await res.json()) as { error?: string };
      showToast(body.error || "Failed to delete book.", "error");
      return false;
    }
    showToast("Book deleted.");
    return true;
  } catch (err) {
    reportNetworkError(err, showToast);
    return false;
  }
}

/** Only display plain, bounded backend error strings; never render server markup. */
export async function safeApiError(
  response: Response,
  fallback = "Something went wrong. Please try again."
): Promise<string> {
  try {
    const payload = (await response.json()) as Partial<ApiError>;
    if (typeof payload.error !== "string") return fallback;
    const message = payload.error.replace(/[<>]/g, "").trim();
    return message ? message.slice(0, 240) : fallback;
  } catch {
    return fallback;
  }
}
