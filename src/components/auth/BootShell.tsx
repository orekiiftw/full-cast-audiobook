import { AppBar, BrandLogo, Skeleton } from "../ui";
import { LibraryHeader } from "../library/LibraryHeader";
import { LibrarySkeleton } from "../library/LibrarySkeleton";
import { LIBRARY_PAGE_CLASS } from "../library/layout";

const noop = () => {};

export function BootShell() {
  return (
    <div className="relative flex min-h-screen flex-col bg-surface-0 text-ink-primary" aria-busy="true">
      <AppBar>
        <span className="-ml-1 p-1">
          <BrandLogo />
        </span>
        <div className="flex items-center gap-3" aria-hidden="true">
          <Skeleton className="hidden h-8 w-32 rounded-full md:block" />
          <Skeleton className="h-11 w-24 rounded-full sm:w-72" />
        </div>
      </AppBar>
      <div aria-hidden="true" className="h-px w-full overflow-hidden">
        <div className="h-px w-full origin-left animate-boot-sweep bg-gold-400/60" />
      </div>

      <main className="relative flex-1 pb-20">
        <div className={LIBRARY_PAGE_CLASS}>
          <LibraryHeader onAddBook={noop} disabled />
          <LibrarySkeleton />
        </div>
      </main>
      <span className="sr-only" role="status">
        Restoring your Narratea session…
      </span>
    </div>
  );
}
