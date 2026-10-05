import { mock } from "bun:test";

export const ZIP_BUFFER = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);

export const VALID_CID = "bafybeigdyrzt5sfp7udm7uh76uh7y26nf3efuylqabf3oclgtqy55fbzdi";

const originalFetch = globalThis.fetch;

const originalTorBoxApiKey = process.env.TORBOX_API_KEY;

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
}
