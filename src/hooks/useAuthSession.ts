import { useCallback, useEffect, useRef, useState } from "react";
import { AUTH_EXPIRED_EVENT } from "../lib/api";
import { clearSessionHint, markSessionHint } from "../lib/sessionHint";
import { resetSharedAudio } from "../lib/sharedAudio";
import { fetchAuthenticatedUser, preloadLibrary, requestLogout } from "./sessionBootstrap";
import type { AuthUser, Book } from "../types/api";

type AuthStatus = "loading" | "authenticated" | "anonymous";

export function useAuthSession() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const bootBooksRef = useRef<Promise<Book[] | null> | null>(null);

  const clearSession = useCallback((expired: boolean) => {
    resetSharedAudio();
    clearSessionHint();
    bootBooksRef.current = null;
    setUser(null);
    setSessionExpired(expired);
    setAuthStatus("anonymous");
  }, []);

  useEffect(() => {
    let cancelled = false;

    bootBooksRef.current = preloadLibrary();

    const restoreSession = async () => {
      try {
        const authenticatedUser = await fetchAuthenticatedUser();
        if (cancelled) return;
        if (!authenticatedUser) {
          clearSession(false);
          return;
        }
        markSessionHint();
        setUser(authenticatedUser);
        setAuthStatus("authenticated");
      } catch (error) {
        console.error("Unable to restore auth session:", error);
        if (!cancelled) clearSession(false);
      }
    };

    void restoreSession();
    return () => {
      cancelled = true;
    };
  }, [clearSession]);

  useEffect(() => {
    const handleAuthExpired = () => clearSession(true);
    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
  }, [clearSession]);

  const handleAuthenticated = (authenticatedUser: AuthUser) => {
    markSessionHint();
    bootBooksRef.current = null;
    setUser(authenticatedUser);
    setSessionExpired(false);
    setAuthStatus("authenticated");
  };

  const handleLogout = async () => {
    await requestLogout();
    clearSession(false);
  };

  return {
    authStatus,
    user,
    sessionExpired,
    bootBooks: bootBooksRef.current,
    handleAuthenticated,
    handleLogout,
  };
}
