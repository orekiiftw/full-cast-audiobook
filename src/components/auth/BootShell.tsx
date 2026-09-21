import { BrandLogo } from "../ui";

export function BootShell() {
  return (
    <div
      className="min-h-screen text-cinema-100 flex flex-col font-sans grainy"
      aria-busy="true"
      aria-label="Restoring your Narratea session"
    >
      <header className="app-header sticky top-0 z-40 border-b border-white/[0.04]">
        <div className="max-w-6xl mx-auto px-5 sm:px-6 h-16 flex justify-between items-center gap-4">
          <BrandLogo />
        </div>
      </header>
      <main className="flex-1 relative z-10 pb-16">
        <div className="max-w-6xl mx-auto px-5 sm:px-6 py-12 sm:py-16">
          <div className="mb-14 space-y-4">
            <div className="h-3 w-24 rounded-md bg-white/[0.05]" />
            <div className="h-10 w-48 rounded-md bg-white/[0.06]" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-5 gap-y-10">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-3">
                <div className="aspect-[2/3] rounded-2xl bg-cinema-900 shimmer" />
                <div className="h-4 w-3/4 rounded-md bg-white/[0.05]" />
                <div className="h-3 w-1/2 rounded-md bg-white/[0.04]" />
              </div>
            ))}
          </div>
        </div>
      </main>
      <span className="sr-only">Loading</span>
    </div>
  );
}
