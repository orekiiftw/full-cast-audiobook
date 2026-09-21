import { LibraryBookCover } from "./LibraryBookCover";
import type { Book } from "../../types/api";

interface LibraryBookCardProps {
  book: Book;
  index: number;
  onSelect: (bookId: string) => void;
  onDelete: (event: React.MouseEvent, bookId: string, bookTitle: string) => void;
}

export function LibraryBookCard({ book, index, onSelect, onDelete }: LibraryBookCardProps) {
  return (
    <div
      onClick={() => onSelect(book.id)}
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
      className="group cursor-pointer flex flex-col gap-3.5 animate-fade-up transition-transform duration-500 ease-out-expo hover:-translate-y-2"
    >
      <LibraryBookCover book={book} onDelete={onDelete} />

      <div className="px-0.5">
        <h3 className="font-serif font-medium text-[15px] leading-snug line-clamp-2 transition-colors group-hover:text-gold-300">
          {book.title}
        </h3>
        <p className="text-xs text-cinema-400 line-clamp-1 mt-1">{book.author}</p>
      </div>
    </div>
  );
}
