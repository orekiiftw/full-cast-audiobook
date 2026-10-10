import { BrandLogo } from "../ui";

// A session check usually resolves in well under a second, so the mark waits briefly before
// fading in; fast restores then never flash a loading screen at all.
const REVEAL_DELAY = { animationDelay: "320ms" };

export function AuthLoadingGate() {
  return (
    <main
      className="relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-surface-0 px-5 text-ink-primary"
      aria-busy="true"
      aria-label="Restoring your Narratea session"
    >
      <div className="atmosphere -z-10" aria-hidden="true" />
      <div className="flex flex-col items-center animate-fade" style={REVEAL_DELAY}>
        <BrandLogo size="md" animated />
        <div className="mt-8 h-px w-40 overflow-hidden rounded-full bg-line-strong" aria-hidden="true">
          <div className="h-px w-2/5 animate-indeterminate rounded-full bg-gold-400/80" />
        </div>
        <p className="eyebrow mt-4" aria-hidden="true">
          Tuning the room
        </p>
      </div>
      <span className="sr-only" role="status">
        Restoring your Narratea session…
      </span>
    </main>
  );
}
