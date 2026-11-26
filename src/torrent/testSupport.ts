import { mock } from "bun:test";
import { createMockEpub } from "../epub/testFixture";

// A real EPUB, because downloads are now verified to carry a readable spine before a candidate is accepted.
export const ZIP_BUFFER = createMockEpub({});

export const VALID_CID = "bafybeigdyrzt5sfp7udm7uh76uh7y26nf3efuylqabf3oclgtqy55fbzdi";

const originalFetch = globalThis.fetch;

const originalTorBoxApiKey = process.env.TORBOX_API_KEY;

const originalCatalogueBaseUrl = process.env.CATALOGUE_BASE_URL;

export function zipResponse(): Response {
  return new Response(new Uint8Array(ZIP_BUFFER), { headers: { "content-length": String(ZIP_BUFFER.length) } });
}

export function mockFetch(handler: (url: string) => Promise<Response>): void {
  globalThis.fetch = mock(async (input: RequestInfo | URL): Promise<Response> => handler(String(input))) as unknown as typeof fetch;
}

export function restoreFetchAndEnvironment(): void {
  globalThis.fetch = originalFetch;
  if (originalTorBoxApiKey === undefined) delete process.env.TORBOX_API_KEY;
  else process.env.TORBOX_API_KEY = originalTorBoxApiKey;
  if (originalCatalogueBaseUrl === undefined) delete process.env.CATALOGUE_BASE_URL;
  else process.env.CATALOGUE_BASE_URL = originalCatalogueBaseUrl;
}
