import { lookup as dnsLookup } from "node:dns/promises";

interface ResolvedAddress {
  address: string;
  family: number;
}

interface DnsCacheEntry {
  addresses: ResolvedAddress[];
  expiresAt: number;
}

const DNS_CACHE_TTL_MS = 30_000;

const dnsCache = new Map<string, DnsCacheEntry>();

export function isPrivateIpv4(a: number, b: number): boolean {
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a >= 224) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export function isPrivateIp(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("2001:db8")
  ) {
    return true;
  }
  const mapped = /^::(?:ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i.exec(normalized);
  if (mapped) {
    return isPrivateIpv4(Number(mapped[1]), Number(mapped[2]));
  }
  const mappedHex = /^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(normalized);
  if (mappedHex) {
    const high = parseInt(mappedHex[1], 16);
    return isPrivateIpv4(high >> 8, high & 0xff);
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (ipv4) {
    return isPrivateIpv4(Number(ipv4[1]), Number(ipv4[2]));
  }
  return false;
}

export function isPrivateHost(host: string): boolean {
  if (host === "localhost" || host === "::1" || host === "[::1]") return true;
  const mappedHost = /^\[?::(?:ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\]?$/i.exec(host);
  if (mappedHost) return isPrivateIpv4(Number(mappedHost[1]), Number(mappedHost[2]));
  const mappedHexHost = /^\[?::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})\]?$/i.exec(host);
  if (mappedHexHost) {
    const high = parseInt(mappedHexHost[1], 16);
    return isPrivateIpv4(high >> 8, high & 0xff);
  }
  const ipv4Host = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4Host) {
    return isPrivateIpv4(Number(ipv4Host[1]), Number(ipv4Host[2]));
  }
  return false;
}

async function resolveHostCached(host: string): Promise<ResolvedAddress[]> {
  const cached = dnsCache.get(host);
  if (cached && cached.expiresAt > Date.now()) {
    dnsCache.delete(host);
    dnsCache.set(host, { addresses: cached.addresses, expiresAt: Date.now() + DNS_CACHE_TTL_MS });
    return cached.addresses;
  }
  if (dnsCache.size > 100) {
    const oldest = dnsCache.keys().next().value;
    if (oldest) dnsCache.delete(oldest);
  }
  const addresses = await dnsLookup(host, { all: true });
  dnsCache.set(host, { addresses, expiresAt: Date.now() + DNS_CACHE_TTL_MS });
  return addresses;
}

export function assertSafeDownloadUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("TorBox returned an invalid download URL.");
  }
  if (url.protocol !== "https:") {
    throw new Error("TorBox returned a non-HTTPS download URL.");
  }
  const host = url.hostname.toLowerCase();
  const isTorBoxHost = (candidate: string) =>
    candidate === "torbox.app" ||
    candidate.endsWith(".torbox.app") ||
    candidate === "tb-cdn.pw" ||
    candidate.endsWith(".tb-cdn.pw") ||
    candidate === "tb-cdn.io" ||
    candidate.endsWith(".tb-cdn.io");
  if (!isTorBoxHost(host)) {
    throw new Error(`TorBox returned a download URL on an unexpected host: ${host}`);
  }
  if (isPrivateHost(host)) {
    throw new Error("TorBox returned a download URL resolving to a private address.");
  }
  return url.toString();
}

export async function assertSafeDownloadUrlDns(raw: string): Promise<string> {
  const url = new URL(assertSafeDownloadUrl(raw));
  const host = url.hostname.toLowerCase();
  if (/^[\d.]+$/.test(host) || host.startsWith("[") || host === "::1") return url.toString();

  let addresses: ResolvedAddress[];
  try {
    addresses = await resolveHostCached(host);
  } catch {
    throw new Error(`Could not resolve TorBox download host "${host}".`);
  }
  if (addresses.length === 0) {
    throw new Error(`TorBox download host "${host}" did not resolve to any address.`);
  }
  for (const { address } of addresses) {
    if (isPrivateIp(address)) {
      throw new Error(`TorBox download host "${host}" resolved to a private address (${address}).`);
    }
  }
  return url.toString();
}

export function isIpfsCid(cid: string): boolean {
  return cid.length >= 40 && cid.length <= 80 && /^[0-9A-Za-z]+$/.test(cid);
}
