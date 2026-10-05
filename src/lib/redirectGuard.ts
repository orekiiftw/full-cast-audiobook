type RedirectFailure = "missing-location" | "invalid-target" | "redirect-limit";

interface RedirectContext {
  initialUrl: URL;
  currentUrl: URL;
  hops: number;
}

export interface RedirectGuard {
  approve: (target: URL, context: RedirectContext) => URL | Promise<URL>;
  fail: (failure: RedirectFailure) => Error;
  maxHops?: number;
}

const DEFAULT_MAX_REDIRECT_HOPS = 3;

const REDIRECT_PROBLEMS: Record<RedirectFailure, string> = {
  "missing-location": "redirected without a Location header",
  "invalid-target": "redirected to an invalid target URL",
  "redirect-limit": "exceeded its redirect limit",
};

export function redirectFailureMessage(label: string, failure: RedirectFailure): string {
  return `${label} ${REDIRECT_PROBLEMS[failure]}`;
}

interface GuardedFetchOptions {
  url: string;
  timeoutMs: number;
  guard: RedirectGuard;
  headers?: Record<string, string>;
  method?: string;
  body?: BodyInit;
}

export async function fetchWithRedirectGuard({ url, timeoutMs, guard, headers, method, body }: GuardedFetchOptions): Promise<Response> {
  const initialUrl = new URL(url);
  const maxHops = guard.maxHops ?? DEFAULT_MAX_REDIRECT_HOPS;
  let currentUrl = initialUrl;

  for (let hops = 0; hops <= maxHops; hops++) {
    const response = await fetch(currentUrl, {
      headers,
      method,
      body,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
    });
    if (!isRedirect(response.status)) return response;

    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => {});
    if (!location) throw guard.fail("missing-location");

    const target = parseTarget(location, currentUrl);
    if (!target) throw guard.fail("invalid-target");

    currentUrl = await guard.approve(target, { initialUrl, currentUrl, hops });
  }

  throw guard.fail("redirect-limit");
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

function parseTarget(location: string, base: URL): URL | null {
  try {
    return new URL(location, base);
  } catch {
    return null;
  }
}
