import { Button, Icon } from "../ui";

export function LibraryLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="relative mt-8 overflow-hidden rounded-[2rem] border border-white/[0.06] bg-gradient-to-b from-cinema-900/80 to-cinema-950/60 px-8 py-16 text-center shadow-elevated">
      <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/[0.08] text-red-300">
        <Icon name="x" size={22} />
      </div>
      <h2 className="font-serif text-2xl font-medium tracking-tight text-gradient mb-3">Your library couldn’t be loaded</h2>
      <p className="text-cinema-400 text-sm mb-8 leading-relaxed max-w-sm mx-auto">
        The server didn’t answer. Check that it’s running, then try again.
      </p>
      <Button variant="secondary" onClick={onRetry}>
        <Icon name="refresh" size={14} />
        Retry
      </Button>
    </div>
  );
}
