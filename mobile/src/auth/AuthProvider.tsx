import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, setBearerToken, setUnauthorizedHandler } from "@/api/client";
import { clearStoredSession, fetchCurrentUser, loadStoredSession, logIn, requestLogout, signUp, storeSession } from "@/api/auth";
import type { AuthUser } from "@/api/types";

// Mirrors `src/hooks/useAuthSession.ts`: bootstrap from the stored token on launch, treat a
// dead token as "anonymous", and clear the whole session the moment any request answers 401.

export type AuthStatus = "loading" | "authenticated" | "anonymous";

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  sessionExpired: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  createAccount: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const bootstrappedRef = useRef(false);

  const clearSession = useCallback((expired: boolean) => {
    setBearerToken(null);
    setUser(null);
    setSessionExpired(expired);
    setStatus("anonymous");
    void clearStoredSession();
  }, []);

  const adoptSession = useCallback(async (token: string, expiresAt: string, nextUser: AuthUser) => {
    await storeSession({ token, expiresAt });
    setUser(nextUser);
    setSessionExpired(false);
    setStatus("authenticated");
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => clearSession(true));
    return () => setUnauthorizedHandler(null);
  }, [clearSession]);

  useEffect(() => {
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    let cancelled = false;

    const bootstrap = async () => {
      const stored = await loadStoredSession();
      if (cancelled) return;

      if (!stored) {
        clearSession(false);
        return;
      }

      setBearerToken(stored.token);
      try {
        const currentUser = await fetchCurrentUser();
        if (cancelled) return;
        if (!currentUser) {
          clearSession(false);
          return;
        }
        setUser(currentUser);
        setStatus("authenticated");
      } catch (error) {
        if (cancelled) return;
        // Unreachable API: keep the token so a later launch can retry, but do not pretend to
        // be signed in without a verified identity.
        if (error instanceof ApiError) console.warn("Session bootstrap failed:", error.message);
        clearSession(false);
      }
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [clearSession]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const session = await logIn(email.trim(), password);
      await adoptSession(session.token, session.expiresAt, session.user);
    },
    [adoptSession],
  );

  const createAccount = useCallback(
    async (email: string, password: string) => {
      const session = await signUp(email.trim(), password);
      await adoptSession(session.token, session.expiresAt, session.user);
    },
    [adoptSession],
  );

  const signOut = useCallback(async () => {
    await requestLogout();
    clearSession(false);
  }, [clearSession]);

  const value = useMemo(
    () => ({ status, user, sessionExpired, signIn, createAccount, signOut }),
    [status, user, sessionExpired, signIn, createAccount, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
