const SESSION_COOKIE = "narratea_session";

const BEARER_PREFIX_RE = /^Bearer +/i;

const WHITESPACE_RE = /\s/;

export function readCookieSessionToken(req: Request): string | null {
  const cookie = req.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name !== SESSION_COOKIE) continue;
    try {
      return decodeURIComponent(value.join("="));
    } catch {
      return null;
    }
  }
  return null;
}

export function readBearerSessionToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;

  const trimmed = header.trim();
  const match = BEARER_PREFIX_RE.exec(trimmed);
  if (!match) return null;

  const token = trimmed.slice(match[0].length);
  if (token.length === 0 || WHITESPACE_RE.test(token)) return null;
  return token;
}

export function readSessionToken(req: Request): string | null {
  return readBearerSessionToken(req) ?? readCookieSessionToken(req);
}

export { SESSION_COOKIE };
