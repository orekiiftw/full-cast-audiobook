import { expect, test } from "bun:test";
import { assertSafeDownloadUrl, buildTorrentSearchQueries } from "./torboxService";

test("buildTorrentSearchQueries normalizes initials and adds surname fallback", () => {
  expect(buildTorrentSearchQueries("Harry Potter and the Philosopher's Stone", "J.K. Rowling")).toEqual([
    "Harry Potter and the Philosopher s Stone J K Rowling epub",
    "Harry Potter and the Philosopher s Stone Rowling epub",
    "Harry Potter and the Philosopher s Stone epub",
    "Harry Potter Philosopher Stone Rowling epub",
    "Harry Potter epub",
  ]);
});

test("buildTorrentSearchQueries removes duplicate variants for a minimal query", () => {
  expect(buildTorrentSearchQueries("Dune", "Herbert")).toEqual([
    "Dune Herbert epub",
    "Dune epub",
  ]);
});

test("assertSafeDownloadUrl accepts current TorBox CDN hosts", () => {
  // Live requestdl responses observed from the TorBox API.
  expect(assertSafeDownloadUrl("https://nexus-008.indi.tb-cdn.pw/dld/a8624295-2293-44b7-9711-ae0271b25b7a?token=x"))
    .toBe("https://nexus-008.indi.tb-cdn.pw/dld/a8624295-2293-44b7-9711-ae0271b25b7a?token=x");
  expect(assertSafeDownloadUrl("https://cdn.torbox.app/dld/file")).toContain("cdn.torbox.app");
  expect(assertSafeDownloadUrl("https://tb-cdn.pw/dld/file")).toContain("tb-cdn.pw");
});

test("assertSafeDownloadUrl rejects non-HTTPS, spoofed, and private hosts", () => {
  expect(() => assertSafeDownloadUrl("http://nexus-008.indi.tb-cdn.pw/dld/x")).toThrow("non-HTTPS");
  expect(() => assertSafeDownloadUrl("https://tb-cdn.pw.evil.com/dld/x")).toThrow("unexpected host");
  expect(() => assertSafeDownloadUrl("https://evil.com/?x=tb-cdn.pw")).toThrow("unexpected host");
  expect(() => assertSafeDownloadUrl("not a url")).toThrow("invalid download URL");
  // Private/loopback hosts are not on the TorBox allowlist, so they are
  // rejected at the host check before the private-address guard is reached.
  expect(() => assertSafeDownloadUrl("https://localhost/dld/x")).toThrow("unexpected host");
  expect(() => assertSafeDownloadUrl("https://192.168.1.1/dld/x")).toThrow("unexpected host");
});
