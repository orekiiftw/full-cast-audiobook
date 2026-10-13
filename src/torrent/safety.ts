import { lookup as dnsLookup } from "node:dns/promises";
import { isAllowedHost } from "../lib/hosts";

interface ResolvedAddress {
  address: string;
  family: number;
}

const DNS_CACHE_TTL_MS = 30_000;

interface DnsCacheEntry {
  addresses: ResolvedAddress[];
  expiresAt: number;
}

const dnsCache = new Map<string, DnsCacheEntry>();

const SPECIAL_IPV6_RANGES = [
  { cidr: "::/96", embeddedIpv4At: 96 },
  { cidr: "::ffff:0:0/96", embeddedIpv4At: 96 },
  { cidr: "64:ff9b::/96", embeddedIpv4At: 96 },
  { cidr: "2002::/16", embeddedIpv4At: 16 },
  { cidr: "64:ff9b:1::/48" },
  { cidr: "100::/64" },
  { cidr: "2001::/23" },
  { cidr: "2001:db8::/32" },
  { cidr: "fc00::/7" },
  { cidr: "fe80::/10" },
  { cidr: "fec0::/10" },
  { cidr: "ff00::/8" },
].map(({ cidr, embeddedIpv4At }) => {
  const [network, prefixLength] = cidr.split("/");
  const shift = BigInt(128 - Number(prefixLength));
  return { prefix: parseIpv6(network)! >> shift, shift, embeddedIpv4At };
});

export function isPrivateIp(ip: string): boolean {
  const ipv4 = parseIpv4(ip);
  if (ipv4) return isPrivateIpv4(ipv4[0], ipv4[1]);
  const ipv6 = parseIpv6(ip);
  return ipv6 !== null && isPrivateIpv6(ipv6);
}

export function isPrivateHost(host: string): boolean {
  return host === "localhost" || isPrivateIp(host.replace(/^\[(.*)\]$/, "$1"));
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
  if (!isAllowedHost(host, ["torbox.app", "tb-cdn.pw", "tb-cdn.io"])) {
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

function isPrivateIpv4(a: number, b: number): boolean {
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

function isPrivateIpv6(address: bigint): boolean {
  const range = SPECIAL_IPV6_RANGES.find(({ prefix, shift }) => address >> shift === prefix);
  if (!range) return false;
  if (range.embeddedIpv4At === undefined) return true;
  const ipv4 = Number((address >> BigInt(96 - range.embeddedIpv4At)) & 0xffffffffn);
  return isPrivateIpv4(ipv4 >>> 24, (ipv4 >>> 16) & 0xff);
}

function parseIpv4(ip: string): number[] | null {
  const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)?.slice(1).map(Number);
  return octets && octets.every((octet) => octet <= 255) ? octets : null;
}

function parseIpv6(ip: string): bigint | null {
  const halves = ip.split("%")[0].split("::");
  if (halves.length > 2) return null;
  const head = parseIpv6Groups(halves[0], halves.length === 1);
  const tail = halves.length === 2 ? parseIpv6Groups(halves[1], true) : [];
  if (!head || !tail) return null;
  const zeros = 8 - head.length - tail.length;
  if (halves.length === 1 ? zeros !== 0 : zeros < 1) return null;
  return [...head, ...new Array<number>(zeros).fill(0), ...tail].reduce((address, group) => (address << 16n) | BigInt(group), 0n);
}

function parseIpv6Groups(part: string, allowIpv4Suffix: boolean): number[] | null {
  if (part === "") return [];
  const pieces = part.split(":");
  const ipv4 = allowIpv4Suffix ? parseIpv4(pieces[pieces.length - 1]) : null;
  const hexPieces = ipv4 ? pieces.slice(0, -1) : pieces;
  if (!hexPieces.every((piece) => /^[0-9a-f]{1,4}$/i.test(piece))) return null;
  const groups = hexPieces.map((piece) => parseInt(piece, 16));
  return ipv4 ? [...groups, (ipv4[0] << 8) | ipv4[1], (ipv4[2] << 8) | ipv4[3]] : groups;
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
