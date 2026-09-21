const SESSION_HINT_KEY = "narratea:has-session";

export function hasSessionHint(): boolean {
  try {
    return localStorage.getItem(SESSION_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

export function markSessionHint(): void {
  try {
    localStorage.setItem(SESSION_HINT_KEY, "1");
  } catch {}
}

export function clearSessionHint(): void {
  try {
    localStorage.removeItem(SESSION_HINT_KEY);
  } catch {}
}
