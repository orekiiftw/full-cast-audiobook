import { Badge, IconButton } from "../ui";
import { LibraryBookCover } from "./LibraryBookCover";
import { bookStatusOf } from "./bookStatus";
import type { Book } from "../../types/api";

const STAGGER_STEP_MS = 40;
const MAX_STAGGERED_CARDS = 8;

interface LibraryBookCardProps {
  book: Book;
  index: number;
  onSelect: (bookId: string) => void;
  onDelete: (event: React.MouseEvent, bookId: string, bookTitle: string) => void;
}

export function LibraryBookCard({ book, index, onSelect, onDelete }: LibraryBookCardProps) {
  const author = book.author.trim() || "Unknown author";
  const status = bookStatusOf(book.status);
  const accessibleName = book.status === "ready" ? `${book.title} by ${author}` : `${book.title} by ${author}, ${status.label}`;

  return (
    <li className="group relative animate-rise" style={{ animationDelay: `${Math.min(index, MAX_STAGGERED_CARDS) * STAGGER_STEP_MS}ms` }}>
      <button
        type="button"
        onClick={() => onSelect(book.id)}
        aria-label={accessibleName}
        className="flex w-full flex-col gap-3 rounded-tile text-left focus-visible:outline-offset-4"
      >
        <LibraryBookCover book={book} />
        <span className="block w-full min-w-0 px-0.5">
          <span className="line-clamp-2 break-words font-serif text-body-lg font-medium text-ink-primary transition-colors duration-base group-hover:text-gold-200">
            {book.title}
          </span>
          <span className="mt-0.5 block truncate text-caption text-ink-tertiary">{author}</span>
          {book.status !== "ready" && (
            <span className="mt-2 flex sm:hidden">
              <Badge tone={status.tone} pulse={status.pulse}>
                {status.label}
              </Badge>
            </span>
          )}
        </span>
      </button>

      <IconButton
        icon="trash"
        label={`Delete ${book.title}`}
        variant="glass"
        size="sm"
        onClick={(event) => onDelete(event, book.id, book.title)}
        className="absolute left-2 top-2 z-10 opacity-0 transition-opacity duration-base hover:text-danger-300 focus-visible:opacity-100 group-hover:opacity-100 touch:opacity-100"
      />
    </li>
  );
}
