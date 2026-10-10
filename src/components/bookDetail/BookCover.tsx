import { CoverArt } from "../ui";
import type { Book } from "../../types/api";
import { audioUrl } from "../../lib/audioUrl";

export function BookCover({ book }: { book: Book }) {
  return (
    <CoverArt
      src={book.coverR2Key ? audioUrl(book.coverR2Key) : null}
      title={book.title}
      author={book.author}
      size="lg"
      loading="eager"
      className="aspect-cover w-40 shrink-0 self-center rounded-tile shadow-cover sm:w-48 sm:self-start lg:w-56"
    />
  );
}
