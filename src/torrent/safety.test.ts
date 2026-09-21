import { describe, expect, test } from "bun:test";
import { assertSafeDownloadUrl, isIpfsCid, isPrivateHost, isPrivateIp } from "./safety";
import { VALID_CID } from "./testSupport";

test("assertSafeDownloadUrl accepts current TorBox CDN hosts", () => {
  expect(assertSafeDownloadUrl("https://nexus-008.indi.tb-cdn.pw/dld/a8624295-2293-44b7-9711-ae0271b25b7a?token=x")).toBe(
    "https://nexus-008.indi.tb-cdn.pw/dld/a8624295-2293-44b7-9711-ae0271b25b7a?token=x",
  );
  expect(assertSafeDownloadUrl("https://cdn.torbox.app/dld/file")).toContain("cdn.torbox.app");
  expect(assertSafeDownloadUrl("https://tb-cdn.pw/dld/file")).toContain("tb-cdn.pw");
});

test("assertSafeDownloadUrl rejects non-HTTPS, spoofed, and private hosts", () => {
  expect(() => assertSafeDownloadUrl("http://nexus-008.indi.tb-cdn.pw/dld/x")).toThrow("non-HTTPS");
  expect(() => assertSafeDownloadUrl("https://tb-cdn.pw.evil.com/dld/x")).toThrow("unexpected host");
  expect(() => assertSafeDownloadUrl("https://evil.com/?x=tb-cdn.pw")).toThrow("unexpected host");
  expect(() => assertSafeDownloadUrl("not a url")).toThrow("invalid download URL");
  expect(() => assertSafeDownloadUrl("https://localhost/dld/x")).toThrow("unexpected host");
  expect(() => assertSafeDownloadUrl("https://192.168.1.1/dld/x")).toThrow("unexpected host");
});

describe("isPrivateIp", () => {
  test("correctly identifies IPv4-compatible and IPv4-mapped IPv6 addresses", () => {
    expect(isPrivateIp("127.0.0.1")).toBe(true);
    expect(isPrivateIp("10.0.0.1")).toBe(true);
    expect(isPrivateIp("192.168.1.1")).toBe(true);
    expect(isPrivateIp("169.254.169.254")).toBe(true);
    expect(isPrivateIp("8.8.8.8")).toBe(false);

    expect(isPrivateIp("::1")).toBe(true);
    expect(isPrivateIp("::")).toBe(true);
    expect(isPrivateIp("fe80::1")).toBe(true);
    expect(isPrivateIp("2606:4700:4700::1111")).toBe(false);

    expect(isPrivateIp("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateIp("::ffff:169.254.169.254")).toBe(true);
    expect(isPrivateIp("::ffff:8.8.8.8")).toBe(false);
    expect(isPrivateIp("::ffff:7f00:1")).toBe(true);

    expect(isPrivateIp("::127.0.0.1")).toBe(true);
    expect(isPrivateIp("::169.254.169.254")).toBe(true);
    expect(isPrivateIp("::10.0.0.5")).toBe(true);
    expect(isPrivateIp("::7f00:1")).toBe(true);
    expect(isPrivateIp("::8.8.8.8")).toBe(false);

    expect(isPrivateHost("[::127.0.0.1]")).toBe(true);
    expect(isPrivateHost("[::ffff:127.0.0.1]")).toBe(true);
    expect(isPrivateHost("127.0.0.1")).toBe(true);
    expect(isPrivateHost("example.com")).toBe(false);
  });
});

describe("isIpfsCid", () => {
  test("accepts Qm and bafy CIDs", () => {
    expect(isIpfsCid(VALID_CID)).toBe(true);
    expect(isIpfsCid("QmYwAPJzv5CZsnAzt8auVZRn2TT8SqBHLQqQ8FQtiQkz")).toBe(true);
  });

  test("rejects too-short, empty, and non-alphanumeric values", () => {
    expect(isIpfsCid("abc")).toBe(false);
    expect(isIpfsCid("")).toBe(false);
    expect(isIpfsCid("bafy-./:?")).toBe(false);
  });
});
