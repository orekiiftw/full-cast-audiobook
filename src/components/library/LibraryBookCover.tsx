import { Badge, Icon } from "../ui";
import type { Book } from "../../types/api";

const STATUS_TONE: Record<Book["status"], { tone: "cyan" | "purple" | "gold" | "red" | "emerald"; pulse: boolean; label: string }> = {
  discovering: { tone: "cyan", pulse: false, label: "Discovering" },
  casting: { tone: "purple", pulse: true, label: "Preparing" },
  in_progress: { tone: "gold", pulse: true, label: "In Progress" },
  failed: { tone: "red", pulse: false, label: "Failed" },
  ready: { tone: "emerald", pulse: false, label: "Ready" },
};

interface LibraryBookCoverProps {
  book: Book;
  onDelete: (event: React.MouseEvent, bookId: string, bookTitle: string) => void;
}

export function LibraryBookCover({ book, onDelete }: LibraryBookCoverProps) {
  const status = STATUS_TONE[book.status] ?? { tone: "cyan" as const, pulse: true, label: book.status };

  return (
    <div className="cover-frame aspect-[2/3] rounded-2xl overflow-hidden bg-cinema-900 shadow-cover ring-1 ring-white/[0.06] transition-all duration-500 ease-out-expo group-hover:shadow-elevated group-hover:ring-gold-500/25">
      {book.coverR2Key ? (
        <>
          <img
            src={`/api/audio?key=${encodeURIComponent(book.coverR2Key)}`}
            alt={book.title}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover transition-transform duration-700 ease-out-expo group-hover:scale-[1.04]"
          />
          <div className="absolute top-2.5 right-2.5 z-10">
            <Badge tone={status.tone} pulse={status.pulse}>
              {status.label}
            </Badge>
          </div>
        </>
      ) : (
        <div className="w-full h-full bg-gradient-to-br from-cinema-800 via-cinema-900 to-cinema-950 p-4 sm:p-5 flex flex-col justify-between">
          <div className="flex items-start justify-between gap-2 pl-8 sm:pl-0">
            <div className="min-w-0 truncate pt-1 text-[9px] uppercase tracking-[0.2em] text-gold-400/80 font-medium">Narratea</div>
            <div className="shrink-0 -mt-1 -mr-1">
              <Badge tone={status.tone} pulse={status.pulse}>
                {status.label}
              </Badge>
            </div>
          </div>
          <div className="font-serif text-[15px] font-medium line-clamp-4 leading-snug text-cinema-100">{book.title}</div>
          <div className="text-xs text-cinema-400 line-clamp-1 italic font-serif">{book.author}</div>
        </div>
      )}

      <button
        type="button"
        aria-label={`Delete ${book.title}`}
        onClick={(event) => onDelete(event, book.id, book.title)}
        className="absolute top-2.5 left-2.5 z-10 opacity-0 group-hover:opacity-100 max-sm:opacity-100 transition-opacity w-9 h-9 rounded-full glass-strong text-cinema-300 hover:text-red-300 flex items-center justify-center"
      >
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}
