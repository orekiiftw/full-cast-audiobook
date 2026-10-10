import { Badge, CoverArt, Icon } from "../ui";
import type { Book } from "../../types/api";
import { audioUrl } from "../../lib/audioUrl";
import { bookStatusOf } from "./bookStatus";

export function LibraryBookCover({ book }: { book: Book }) {
  const status = bookStatusOf(book.status);
  const listenable = book.status === "ready" || book.status === "in_progress";

  return (
    <span className="relative block aspect-cover w-full transition-transform duration-enter ease-out-expo group-hover:-translate-y-1">
      <CoverArt
        src={book.coverR2Key ? audioUrl(book.coverR2Key) : null}
        title={book.title}
        author={book.author}
        className="h-full w-full rounded-tile shadow-cover transition-shadow duration-enter ease-out-expo group-hover:shadow-cover-lift"
        imageClassName="transition-transform duration-slow ease-out-expo group-hover:scale-105"
      />

      {book.status !== "ready" && (
        // Left padding keeps the badge clear of the delete control in the opposite corner. Below
        // `sm` a two-up shelf leaves the cover too narrow for the pill, so the card carries the
        // status under the author instead.
        <span className="absolute inset-x-2 top-2 z-10 hidden justify-end pl-11 sm:flex">
          <span className="chrome-glass max-w-full rounded-full">
            <Badge tone={status.tone} pulse={status.pulse}>
              {status.label}
            </Badge>
          </span>
        </span>
      )}

      <span
        aria-hidden="true"
        className="absolute bottom-3 right-3 z-10 flex h-10 w-10 translate-y-1 items-center justify-center rounded-full bg-gold-300 text-ink-inverse opacity-0 shadow-accent-lift transition duration-base ease-out-expo group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:translate-y-0 group-hover:opacity-100"
      >
        <Icon name={listenable ? "play" : "arrowRight"} size={18} />
      </span>
    </span>
  );
}
