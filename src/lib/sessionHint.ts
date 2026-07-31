/**
 * Optimistic "probably signed in" marker.
 *
 * The session cookie is HttpOnly, so JS can't read it. Without a hint, every
 * cold boot showed a full-screen loading gate while /api/auth/me round-tripped
 * (~300–900ms on a remote DB), and only then did the library start fetching
 * /api/books — a strictly sequential waterfall. With the hint, the app renders
 * the shell instantly and prefetches the library in parallel with the session
 * check. The hint only steers optimistic UI; every API call still enforces the
 * real session server-side, and a 401 clears it.
 */
const KEY = "narratea:has-session";

export function hasSessionHint(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function markSessionHint(): void {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    // storage unavailable (private mode etc.) — optimistic boot just won't kick in
  }
}

export function clearSessionHint(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
