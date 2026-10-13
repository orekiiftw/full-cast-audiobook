import { mock } from "bun:test";

export function redirectResponse(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } });
}

export function mockFetchFollowingRedirects(handler: (url: string) => Response): string[] {
  const requested: string[] = [];
  const respond = (url: string): Response => {
    requested.push(url);
    return handler(url);
  };
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let url = String(input);
    let response = respond(url);
    while (init?.redirect !== "manual" && response.status >= 300 && response.status < 400) {
      url = new URL(response.headers.get("location") ?? "", url).toString();
      response = respond(url);
    }
    return response;
  }) as unknown as typeof fetch;
  return requested;
}
