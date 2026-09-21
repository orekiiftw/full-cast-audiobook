import { env } from "../lib/env";
import { fetchWithRedirectGuard, redirectFailureMessage, type RedirectGuard } from "../lib/redirectGuard";
import { errorMessage } from "./client";
import { readVerifiedBook } from "./download";
import { isIpfsCid } from "./safety";
import type { TorrentCandidate } from "./types";

const IPFS_TIMEOUT_MS = 10 * 60_000;
const IPFS_GATEWAY_HOSTS = ["ipfs.io", "dweb.link", "w3s.link", "nftstorage.link"];

function ipfsRedirectGuard(allowedHosts: string[]): RedirectGuard {
  return {
    approve: (target, { currentUrl }) => {
      const staysOnTrustedHost = target.hostname === currentUrl.hostname && target.protocol === currentUrl.protocol;
      if (target.protocol !== "https:" && !staysOnTrustedHost) {
        throw new Error(`IPFS redirect to insecure protocol: ${target.protocol}`);
      }
      if (!allowedHosts.includes(target.hostname)) {
        throw new Error(`IPFS redirect to unapproved host: ${target.hostname}`);
      }
      return target;
    },
    fail: (failure) => new Error(redirectFailureMessage("IPFS", failure)),
  };
}

async function fetchIpfsWithValidatedRedirects(
  url: string,
  allowedHosts: string[],
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetchWithRedirectGuard({ url, timeoutMs: IPFS_TIMEOUT_MS, guard: ipfsRedirectGuard(allowedHosts), headers });
}

export async function downloadBookFromIpfs(
  cid: string,
  onProgress?: (message: string) => void,
): Promise<{ buffer: Buffer; filename: string } | null> {
  if (!isIpfsCid(cid)) return null;
  return (await downloadFromCatalogueNode(cid, onProgress)) ?? downloadFromGateways(cid, onProgress);
}

async function downloadFromCatalogueNode(
  cid: string,
  onProgress?: (message: string) => void,
): Promise<{ buffer: Buffer; filename: string } | null> {
  const base = env("CATALOGUE_BASE_URL");
  if (!base) return null;

  const token = env("CATALOGUE_TOKEN");
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const url = new URL(`ipfs/${cid}`, base.endsWith("/") ? base : `${base}/`).toString();

  try {
    onProgress?.("Downloading from self-hosted VPS IPFS node...");
    const response = await fetchIpfsWithValidatedRedirects(url, [new URL(base).hostname], headers);
    return response.ok ? await readVerifiedBook(response, "book.epub") : null;
  } catch (error) {
    console.warn(`⚠️ Catalogue IPFS node failed: ${errorMessage(error)}`);
    return null;
  }
}

async function downloadFromGateways(
  cid: string,
  onProgress?: (message: string) => void,
): Promise<{ buffer: Buffer; filename: string } | null> {
  const failures: string[] = [];

  for (const host of IPFS_GATEWAY_HOSTS) {
    try {
      onProgress?.(`Downloading from IPFS gateway (${host})...`);
      const response = await fetchIpfsWithValidatedRedirects(`https://${host}/ipfs/${cid}?filename=book.epub`, IPFS_GATEWAY_HOSTS);
      if (response.ok) return await readVerifiedBook(response, "book.epub");
      failures.push(`${host}: HTTP ${response.status}`);
    } catch (error) {
      failures.push(`${host}: ${errorMessage(error)}`);
    }
  }

  console.warn(`⚠️ IPFS download failed on all gateways${failures.length ? `: ${failures.join(" | ")}` : ""}`);
  return null;
}

export async function downloadCandidateFromIpfs(
  candidate: TorrentCandidate,
  onProgress?: (message: string) => void,
): Promise<{ buffer: Buffer; filename: string } | null> {
  if (!candidate.ipfs_cid) return null;
  return downloadBookFromIpfs(candidate.ipfs_cid, onProgress);
}
