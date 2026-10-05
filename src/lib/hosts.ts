export function isAllowedHost(host: string, allowedHosts: readonly string[]): boolean {
  return allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}
