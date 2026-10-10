import { Button, Icon } from "../ui";

interface LibraryHeaderProps {
  onAddBook: () => void;
  bookCount?: number;
  performingCount?: number;
  disabled?: boolean;
}

export function LibraryHeader({ onAddBook, bookCount, performingCount = 0, disabled = false }: LibraryHeaderProps) {
  return (
    <div className="mb-10 flex flex-wrap items-end justify-between gap-x-8 gap-y-6 sm:mb-12">
      <div className="min-w-0 max-w-xl">
        <p className="eyebrow mb-3 flex flex-wrap items-center gap-x-2 text-gold-400">
          Your collection
          {bookCount !== undefined && bookCount > 0 && (
            <span className="text-ink-tertiary">
              <span aria-hidden="true">· </span>
              <span className="tabular-nums">{bookCount}</span> {bookCount === 1 ? "title" : "titles"}
              {performingCount > 0 && (
                <>
                  <span aria-hidden="true"> · </span>
                  <span className="tabular-nums">{performingCount}</span> performing
                </>
              )}
            </span>
          )}
        </p>
        <h1 className="font-serif text-display-lg font-medium text-ink-primary sm:text-display-xl">Library</h1>
        <p className="mt-3 max-w-md text-pretty text-body text-ink-secondary">
          Ebooks, performed. One warm narrator, directed line by line by AI emotion cues.
        </p>
      </div>
      <Button variant="primary" size="lg" onClick={onAddBook} disabled={disabled} className="w-full sm:w-auto">
        <Icon name="plus" size={18} />
        Add book
      </Button>
    </div>
  );
}
