import { Button, CoverArt, Icon, Spinner } from "../ui";

interface PlayerHeaderProps {
  bookTitle: string;
  chapterTitle: string;
  coverSrc?: string | null;
  isBufferingNext: boolean;
  onCollapse: () => void;
}

export function PlayerHeader({ bookTitle, chapterTitle, coverSrc = null, isBufferingNext, onCollapse }: PlayerHeaderProps) {
  return (
    <div className="flex shrink-0 items-start justify-between gap-4 border-b border-line-hairline pb-4 sm:pb-5">
      <div className="flex min-w-0 items-center gap-4">
        <CoverArt
          src={coverSrc}
          title={bookTitle}
          size="xs"
          className="hidden aspect-cover w-12 shrink-0 rounded-control shadow-cover sm:block"
        />
        <div className="min-w-0">
          <p className="eyebrow truncate text-gold-400">{bookTitle}</p>
          <h2 className="mt-1 truncate font-serif text-title-lg font-medium text-ink-primary sm:text-display-md">{chapterTitle}</h2>
          <p className="mt-1 flex h-5 items-center gap-1.5 text-caption text-gold-300" role="status">
            {isBufferingNext && (
              <>
                <Spinner size={12} />
                Performing next line…
              </>
            )}
          </p>
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={onCollapse} aria-expanded={true} className="shrink-0">
        <span className="hidden sm:inline">Collapse</span>
        <span className="sr-only sm:hidden">Collapse player</span>
        <Icon name="chevronDown" size={16} />
      </Button>
    </div>
  );
}
