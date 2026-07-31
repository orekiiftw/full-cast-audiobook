import { AnnaArchiveProvider, TorrentProvider } from "./providers";
import { ProviderRegistry } from "./registry";

export const bookProviders = new ProviderRegistry();

const enabled = new Set((process.env.BOOK_PROVIDERS_ENABLED ?? "torrent").split(",").map((value) => value.trim()).filter(Boolean));
if (enabled.has("torrent")) bookProviders.register(new TorrentProvider());
if (enabled.has("anna-archive")) bookProviders.register(new AnnaArchiveProvider());

export * from "./errors";
export * from "./ranking";
export * from "./types";
export { ProviderRegistry } from "./registry";
