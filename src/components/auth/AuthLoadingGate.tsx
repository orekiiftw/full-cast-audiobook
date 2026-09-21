import { Icon } from "../ui";

export function AuthLoadingGate() {
  return (
    <main
      className="auth-shell grainy flex min-h-screen items-center justify-center px-5 text-cinema-100"
      aria-busy="true"
      aria-label="Restoring your Narratea session"
    >
      <div className="relative z-10 flex flex-col items-center animate-fade-in">
        <span className="flex h-14 w-14 items-center justify-center rounded-[1.25rem] bg-gradient-to-br from-gold-300 via-gold-500 to-gold-700 shadow-glow">
          <Icon name="sparkle" size={21} className="text-cinema-950" />
        </span>
        <span className="mt-5 font-display text-sm font-semibold uppercase tracking-[0.24em] text-gradient">Narratea</span>
        <span className="mt-6 h-4 w-4 animate-spin rounded-full border-2 border-gold-400/25 border-t-gold-400" aria-hidden="true" />
        <span className="sr-only">Loading</span>
      </div>
    </main>
  );
}
