import type { Book } from "../../types/api";
import { audioUrl } from "../../lib/audioUrl";

export function BookCover({ book }: { book: Book }) {
  return (
    <div className="cover-frame relative w-44 shrink-0 aspect-[2/3] rounded-2xl overflow-hidden shadow-cover ring-1 ring-white/10 self-center sm:self-start">
      {book.coverR2Key ? (
        <img src={audioUrl(book.coverR2Key)} alt={book.title} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full bg-gradient-to-br from-cinema-800 via-cinema-900 to-cinema-950 p-5 flex flex-col justify-between text-center">
          <div className="text-[9px] uppercase tracking-[0.28em] font-medium text-gold-400/80">Narratea</div>
          <div className="font-serif text-sm font-medium line-clamp-4 leading-snug">{book.title}</div>
          <div className="text-[10px] text-cinema-400 italic font-serif">{book.author}</div>
        </div>
      )}
    </div>
  );
}
