export interface TorrentHit {
  name: string;
  hash: string;
  size: number;
  seeds: number;
  source: string;
}

export interface TorrentCandidate extends TorrentHit {
  magnet: string;
  cached: boolean | null;
  alive: boolean | null;
  md5?: string;
  ipfs_cid?: string;
}
