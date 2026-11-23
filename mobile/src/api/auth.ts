import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { ApiError, apiJson, setBearerToken } from "./client";
import type { AuthSessionResponse, AuthUser, CurrentUserResponse } from "./types";

// The session token outlives the process, so it lives in the keychain rather than memory.
// SecureStore has no web implementation, so the exported web build falls back to
// localStorage — a dev convenience, not a shipping target.
const TOKEN_KEY = "narratea.session";

export interface StoredSession {
  token: string;
  expiresAt: string;
}

async function readRaw(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function writeRaw(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // Storage disabled: the session simply won't survive a reload.
    }
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function removeRaw(key: string): Promise<void> {
  if (Platform.OS === "web") {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      // Nothing to clean up.
    }
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export async function loadStoredSession(): Promise<StoredSession | null> {
  const raw = await readRaw(TOKEN_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof parsed?.token !== "string" || !parsed.token) return null;
    if (typeof parsed.expiresAt === "string" && Date.parse(parsed.expiresAt) <= Date.now()) {
      await removeRaw(TOKEN_KEY);
      return null;
    }
    return { token: parsed.token, expiresAt: parsed.expiresAt ?? "" };
  } catch {
    await removeRaw(TOKEN_KEY);
    return null;
  }
}

export async function storeSession(session: StoredSession): Promise<void> {
  setBearerToken(session.token);
  await writeRaw(TOKEN_KEY, JSON.stringify(session));
}

export async function clearStoredSession(): Promise<void> {
  setBearerToken(null);
  await removeRaw(TOKEN_KEY);
}

// `client: "native"` asks the API for the bearer token in the body instead of a cookie.
function credentialsRequest(path: string, email: string, password: string): Promise<AuthSessionResponse> {
  return apiJson<AuthSessionResponse>(path, {
    method: "POST",
    body: { email, password, client: "native" },
    notifyOnUnauthorized: false,
  });
}

export function logIn(email: string, password: string): Promise<AuthSessionResponse> {
  return credentialsRequest("/api/auth/login", email, password);
}

export function signUp(email: string, password: string): Promise<AuthSessionResponse> {
  return credentialsRequest("/api/auth/signup", email, password);
}

// Resolves null for a dead token rather than throwing, so bootstrap can tell "not signed in"
// from "the server is unreachable".
export async function fetchCurrentUser(): Promise<AuthUser | null> {
  try {
    const response = await apiJson<CurrentUserResponse>("/api/auth/me", { notifyOnUnauthorized: false });
    return response.user ?? null;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export async function requestLogout(): Promise<void> {
  try {
    await apiJson<{ success?: boolean }>("/api/auth/logout", { method: "POST", notifyOnUnauthorized: false });
  } catch {
    // A failed logout still clears the local session; the server token expires on its own.
  }
}
