import {
  AnnaArchiveProvider,
  ArchiveOrgProvider,
  GutenbergProvider,
  LibgenProvider,
  TorrentProvider,
  fetchEpubFromArchiveOrg,
  fetchEpubFromGutenberg,
  fetchEpubFromLibgen,
} from "./providers";
import { ProviderRegistry } from "./registry";
import { BookProvider } from "./types";

const DEFAULT_ENABLED_PROVIDERS = "torrent,archive-org,gutenberg,libgen";

const ENABLED_PROVIDERS = new Set(
  (process.env.BOOK_PROVIDERS_ENABLED ?? DEFAULT_ENABLED_PROVIDERS)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

export interface LibrarySource {
  provider: string;
  label: string;
  fetchEpub: (
    title: string,
    author: string,
    onProgress?: (message: string) => void,
  ) => Promise<{ buffer: Buffer; filename: string } | null>;
}

interface ProviderManifest {
  provider: BookProvider;
  aliases?: string[];
  librarySource?: Omit<LibrarySource, "provider">;
}

const PROVIDER_MANIFEST: ProviderManifest[] = [
  { provider: new TorrentProvider() },
  {
    provider: new ArchiveOrgProvider(),
    aliases: ["archive_org", "open-library"],
    librarySource: { label: "Internet Archive / Open Library", fetchEpub: fetchEpubFromArchiveOrg },
  },
  {
    provider: new GutenbergProvider(),
    librarySource: { label: "Project Gutenberg", fetchEpub: fetchEpubFromGutenberg },
  },
  {
    provider: new LibgenProvider(),
    librarySource: { label: "LibGen", fetchEpub: fetchEpubFromLibgen },
  },
  { provider: new AnnaArchiveProvider() },
];

export const bookProviders = new ProviderRegistry();

for (const { provider, aliases } of PROVIDER_MANIFEST) {
  if (isEnabled(provider.name, aliases)) bookProviders.register(provider);
}

export function enabledLibrarySources(): LibrarySource[] {
  return PROVIDER_MANIFEST.flatMap(({ provider, aliases, librarySource }) =>
    librarySource && isEnabled(provider.name, aliases) ? [{ provider: provider.name, ...librarySource }] : [],
  );
}

export * from "./errors";
export * from "./ranking";
export * from "./types";
export { ProviderRegistry } from "./registry";

function isEnabled(name: string, aliases: string[] = []): boolean {
  return [name, ...aliases].some((candidate) => ENABLED_PROVIDERS.has(candidate));
}
