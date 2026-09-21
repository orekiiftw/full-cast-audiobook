import { Button, Icon } from "../ui";
import { CLASSICS, type Classic } from "./classics";

interface EmptyLibraryProps {
  onSelectClassic: (classic: Classic) => void;
  onAddBook: () => void;
}

export function EmptyLibrary({ onSelectClassic, onAddBook }: EmptyLibraryProps) {
  return (
    <div className="relative mt-8 overflow-hidden rounded-[2rem] border border-white/[0.06] bg-gradient-to-b from-cinema-900/80 to-cinema-950/60 px-8 py-16 sm:px-14 sm:py-20 text-center shadow-elevated">
      <div className="pointer-events-none absolute inset-0 bg-mesh-gold opacity-80" />
      <div className="pointer-events-none absolute -top-20 left-1/2 h-48 w-72 -translate-x-1/2 rounded-full bg-gold-500/10 blur-3xl" />
      <div className="relative">
        <div className="mx-auto mb-8 flex h-16 w-16 items-center justify-center rounded-2xl border border-gold-500/20 bg-gradient-to-br from-gold-500/15 to-transparent text-gold-400 shadow-glow-sm">
          <Icon name="book" size={28} />
        </div>
        <h2 className="font-serif text-3xl sm:text-4xl font-medium tracking-tight text-gradient mb-3">Begin a performance</h2>
        <p className="text-cinema-400 text-sm sm:text-[15px] mb-10 leading-relaxed max-w-md mx-auto">
          Upload a DRM-free EPUB, search the stacks, or start with a classic.
        </p>
        <div className="flex flex-col gap-2 max-w-sm mx-auto">
          {CLASSICS.map((classic) => (
            <button
              key={classic.title}
              onClick={() => onSelectClassic(classic)}
              className="group flex items-center justify-between gap-3 rounded-xl border border-white/[0.05] bg-white/[0.02] px-4 py-3 text-left text-sm transition-all duration-300 hover:border-gold-500/25 hover:bg-gold-500/[0.06]"
            >
              <span className="text-cinema-200">
                <span className="text-cinema-400">{classic.author}</span>
                <span className="mx-2 text-cinema-600">·</span>
                <span className="font-serif italic text-cinema-100">{classic.title}</span>
              </span>
              <Icon name="chevronRight" size={14} className="shrink-0 text-gold-500/70 transition-transform group-hover:translate-x-0.5" />
            </button>
          ))}
        </div>
        <div className="mt-8">
          <Button variant="primary" onClick={onAddBook}>
            <Icon name="plus" size={16} />
            Add your own
          </Button>
        </div>
      </div>
    </div>
  );
}
