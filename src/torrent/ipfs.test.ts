import { afterEach, describe, expect, test } from "bun:test";
import { downloadBookFromIpfs } from "./ipfs";
import { VALID_CID, ZIP_BUFFER, mockFetch, restoreFetchAndEnvironment, zipResponse } from "./testSupport";

afterEach(restoreFetchAndEnvironment);

describe("downloadBookFromIpfs", () => {
  test("returns bytes from the first working gateway", async () => {
    mockFetch(async (url) => {
      if (url.startsWith("https://ipfs.io/ipfs/")) return zipResponse();
      throw new Error(`Unexpected fetch: ${url}`);
    });
    const result = await downloadBookFromIpfs(VALID_CID);
    expect(result).not.toBeNull();
    expect(result!.buffer).toEqual(ZIP_BUFFER);
  });

  test("returns null when every gateway is unreachable", async () => {
    mockFetch(async () => new Response("boom", { status: 503 }));
    expect(await downloadBookFromIpfs(VALID_CID)).toBeNull();
  });

  test("returns null when a gateway serves a non-zip body", async () => {
    mockFetch(async () => new Response("not a zip", { status: 200 }));
    expect(await downloadBookFromIpfs(VALID_CID)).toBeNull();
  });

  test("rejects a malformed CID without any fetch", async () => {
    let calls = 0;
    mockFetch(async () => {
      calls++;
      return zipResponse();
    });
    expect(await downloadBookFromIpfs("garbage!")).toBeNull();
    expect(calls).toBe(0);
  });

  test("rejects redirects to unapproved hosts", async () => {
    mockFetch(
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: "https://169.254.169.254/latest/meta-data/" },
        }),
    );

    const result = await downloadBookFromIpfs(VALID_CID);
    expect(result).toBeNull();
  });
});
