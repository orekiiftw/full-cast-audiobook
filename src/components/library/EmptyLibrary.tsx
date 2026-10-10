import { Button, CoverArt, EmptyState, Icon } from "../ui";
import { CLASSICS, type Classic } from "./classics";

interface EmptyLibraryProps {
  onSelectClassic: (classic: Classic) => void;
  onAddBook: () => void;
}

export function EmptyLibrary({ onSelectClassic, onAddBook }: EmptyLibraryProps) {
  return (
    <EmptyState
      icon="book"
      eyebrow="An empty stage"
      title="Begin a performance"
      description="Upload a DRM-free EPUB, look a title up by name, or start with one of these classics."
      className="animate-rise"
      actions={
        <Button variant="primary" size="lg" onClick={onAddBook}>
          <Icon name="plus" size={18} />
          Add your own
        </Button>
      }
    >
      <ul role="list" aria-label="Start with a classic" className="grid gap-3 text-left sm:grid-cols-3">
        {CLASSICS.map((classic) => (
          <li key={classic.title}>
            <button
              type="button"
              onClick={() => onSelectClassic(classic)}
              className="group flex w-full items-center gap-3 rounded-tile border border-line-hairline bg-surface-2 p-2.5 text-left transition-colors duration-base ease-standard hover:border-line-accent hover:bg-surface-3 sm:flex-col sm:items-stretch sm:p-3"
            >
              <span
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control border border-line-strong bg-surface-3 text-gold-300 sm:hidden"
              >
                <Icon name="book" size={18} />
              </span>
              <CoverArt
                src={null}
                title={classic.title}
                size="sm"
                className="hidden aspect-cover w-full rounded-control shadow-e-1 transition-transform duration-enter ease-out-expo group-hover:-translate-y-0.5 sm:block"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-serif text-body font-medium text-ink-primary">{classic.title}</span>
                <span className="block truncate text-caption text-ink-tertiary">{classic.author}</span>
              </span>
              <Icon
                name="chevronRight"
                size={16}
                className="shrink-0 text-gold-400 transition-transform group-hover:translate-x-0.5 sm:hidden"
              />
            </button>
          </li>
        ))}
      </ul>
    </EmptyState>
  );
}
