const FORWARDED_PROTOCOLS = new Set(["http", "https"]);

export function trustedForwardedProto(req: Request): string | null {
  if (process.env.TRUST_PROXY !== "true") return null;
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  return proto && FORWARDED_PROTOCOLS.has(proto) ? proto : null;
}

export function publicRequestUrl(req: Request): URL {
  const url = new URL(req.url);
  const forwardedProto = trustedForwardedProto(req);
  if (forwardedProto) url.protocol = `${forwardedProto}:`;
  return url;
}
