import { apiFetch, authUserFromResponse } from "../lib/api";
import { hasSessionHint } from "../lib/sessionHint";
import type { AuthResponse, AuthUser, Book } from "../types/api";

export function preloadLibrary(): Promise<Book[] | null> | null {
  if (!hasSessionHint()) return null;

  return apiFetch("/api/books", { method: "GET" }, { notifyOnUnauthorized: false })
    .then((response) => (response.ok ? (response.json() as Promise<Book[]>) : null))
    .catch(() => null);
}

export async function fetchAuthenticatedUser(): Promise<AuthUser | null> {
  const response = await apiFetch("/api/auth/me", { method: "GET" }, { notifyOnUnauthorized: false });
  if (!response.ok) return null;

  const payload = (await response.json()) as AuthResponse | AuthUser;
  return authUserFromResponse(payload);
}

export async function requestLogout(): Promise<void> {
  try {
    await apiFetch("/api/auth/logout", { method: "POST" }, { notifyOnUnauthorized: false });
  } catch (error) {
    console.error("Logout request failed:", error);
  }
}
