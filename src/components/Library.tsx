import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { Modal } from "./ui/Modal";
import { Skeleton } from "./ui/Skeleton";
import { Icon } from "./ui/Icon";
import { useToast } from "./ui/Toast";
import { apiFetch, reportNetworkError } from "../lib/api";
import type { Book } from "../types/api";

interface LibraryProps {
  onSelectBook: (bookId: string) => void;
  /**
   * In-flight /api/books response started at boot, in parallel with the
   * session check. Consumed once for the first paint; ignored if it failed
   * (falls back to a normal fetch) so a stale prefetch never shows wrong data.
   */
  bootBooks?: Promise<Response> | null;
}

type AddMode = "search" | "magnet" | "file";

const STATUS_TONE: Record<
  Book["status"],
  { tone: "cyan" | "purple" | "gold" | "red" | "emerald"; pulse: boolean; label: string }
> = {
  discovering: { tone: "cyan", pulse: false, label: "Discovering" },
  // Legacy status from the pre–single-narrator pipeline. Books are stamped
  // "in_progress" as soon as ingestion structures chapters now; this entry
  // only renders for older rows mid-migration.
  casting: { tone: "purple", pulse: true, label: "Preparing" },
  in_progress: { tone: "gold", pulse: true, label: "In Progress" },
  failed: { tone: "red", pulse: false, label: "Failed" },
  ready: { tone: "emerald", pulse: false, label: "Ready" },
};

const CLASSICS: Array<{ title: string; author: string }> = [
  { title: "Frankenstein", author: "Mary Shelley" },
  { title: "Dracula", author: "Bram Stoker" },
  { title: "The Time Machine", author: "H. G. Wells" },
];

const ADD_MODES: Array<{ id: AddMode; label: string; icon: "search" | "upload" | "link" }> = [
  { id: "search", label: "Search", icon: "search" },
  { id: "file", label: "Upload", icon: "upload" },
  { id: "magnet", label: "Magnet", icon: "link" },
];

export default function Library({ onSelectBook, bootBooks }: LibraryProps) {
  const { showToast } = useToast();
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [addMode, setAddMode] = useState<AddMode>("search");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [magnet, setMagnet] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchBooks = useCallback(async () => {
    try {
      const res = await apiFetch("/api/books");
      if (res.ok) {
        setBooks((await res.json()) as Book[]);
        setLoadError(false);
      } else if (res.status !== 401) {
        // 401 routes through the auth-expired flow; anything else is a real failure
        setLoadError(true);
      }
    } catch (err) {
      console.error(err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll only while something is actually happening (a book mid-pipeline),
  // and never while the tab is hidden. Idle libraries cost zero requests.
  const booksRef = useRef<Book[]>([]);
  useEffect(() => {
    booksRef.current = books;
  }, [books]);

  useEffect(() => {
    let cancelled = false;

    // First paint: reuse the boot prefetch when it succeeded, else fetch now.
    const primeFromBoot = async (): Promise<boolean> => {
      if (!bootBooks) return false;
      try {
        const res = await bootBooks;
        if (cancelled || !res.ok) return false;
        setBooks((await res.json()) as Book[]);
        setLoadError(false);
        setLoading(false);
        return true;
      } catch {
        return false;
      }
    };
    void primeFromBoot().then((primed) => {
      if (!cancelled && !primed) void fetchBooks();
    });

    const tick = () => {
      if (document.hidden) return;
      const hasActivePipeline = booksRef.current.some(
        (b) => b.status === "discovering" || b.status === "casting" || b.status === "in_progress"
      );
      if (hasActivePipeline) void fetchBooks();
    };
    const interval = setInterval(tick, 5000);
    const handleVisible = () => {
      if (!document.hidden) void fetchBooks();
    };
    document.addEventListener("visibilitychange", handleVisible);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisible);
    };
  }, [fetchBooks, bootBooks]);

  const resetForm = () => {
    setTitle("");
    setAuthor("");
    setMagnet("");
    setFile(null);
  };

  const handleAddBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    // Cheap client-side format check (the server validates again): a magnet
    // URI or a 40-char info-hash, nothing else.
    if (addMode === "magnet") {
      const value = magnet.trim();
      if (!value.startsWith("magnet:?xt=urn:btih:") && !/^[0-9a-fA-F]{40}$/.test(value)) {
        showToast("Enter a magnet link (magnet:?xt=urn:btih:…) or a 40-character info-hash.", "error");
        return;
      }
    }

    setSubmitting(true);

    try {
      const formData = new FormData();
      if (addMode === "file" && file) {
        formData.append("file", file);
      } else if (addMode === "magnet") {
        formData.append("magnet", magnet.trim());
      } else {
        formData.append("title", title.trim());
        formData.append("author", author.trim());
      }

      const res = await apiFetch("/api/books", { method: "POST", body: formData });

      if (res.ok) {
        const newBook = (await res.json()) as Book;
        void fetchBooks();
        setIsModalOpen(false);
        resetForm();
        onSelectBook(newBook.id);
        if (newBook.status === "ready" || newBook.status === "in_progress" || newBook.status === "casting") {
          showToast(`Opened “${newBook.title}”.`);
        } else {
          showToast(`Queued “${newBook.title || "book"}” for performance.`);
        }
      } else {
        const err = (await res.json()) as { error?: string; book?: Book };
        if (err.book?.id) {
          setIsModalOpen(false);
          resetForm();
          onSelectBook(err.book.id);
        }
        showToast(err.error || "Failed to add book.", "error");
      }
    } catch (err) {
      reportNetworkError(err, showToast);
    } finally {
      setSubmitting(false);
    }
  };

  const openClassic = (classic: { title: string; author: string }) => {
    setAddMode("search");
    setTitle(classic.title);
    setAuthor(classic.author);
    setIsModalOpen(true);
  };

  const handleDeleteBook = async (e: React.MouseEvent, bookId: string, bookTitle: string) => {
    e.stopPropagation();
    if (!window.confirm(`Delete "${bookTitle}" from your library?`)) return;

    try {
      const res = await apiFetch(`/api/books/${bookId}`, { method: "DELETE" });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        showToast(err.error || "Failed to delete book.", "error");
        return;
      }
      setBooks((prev) => prev.filter((b) => b.id !== bookId));
      showToast("Book deleted.");
    } catch (err) {
      reportNetworkError(err, showToast);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-5 sm:px-6 py-12 sm:py-16 animate-fade-up">
      <div className="flex flex-wrap justify-between items-end gap-8 mb-14">
        <div className="max-w-xl">
          <p className="label-caps text-gold-400/90 mb-4">Your collection</p>
          <h1 className="font-serif text-4xl sm:text-5xl md:text-[3.25rem] font-medium tracking-tight text-gradient leading-[1.1]">
            Library
          </h1>
          <p className="text-cinema-400 text-[15px] mt-4 leading-relaxed max-w-md">
            Ebooks, performed. One warm narrator, directed line by line by AI emotion cues.
          </p>
        </div>
        <Button variant="primary" size="lg" onClick={() => setIsModalOpen(true)}>
          <Icon name="plus" size={16} />
          Add book
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-5 gap-y-10">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-3">
              <Skeleton className="aspect-[2/3] rounded-2xl shimmer" />
              <Skeleton className="h-4 w-3/4 rounded-md" />
              <Skeleton className="h-3 w-1/2 rounded-md" />
            </div>
          ))}
        </div>
      ) : loadError ? (
        <div className="relative mt-8 overflow-hidden rounded-[2rem] border border-white/[0.06] bg-gradient-to-b from-cinema-900/80 to-cinema-950/60 px-8 py-16 text-center shadow-elevated">
          <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/[0.08] text-red-300">
            <Icon name="x" size={22} />
          </div>
          <h2 className="font-serif text-2xl font-medium tracking-tight text-gradient mb-3">
            Your library couldn’t be loaded
          </h2>
          <p className="text-cinema-400 text-sm mb-8 leading-relaxed max-w-sm mx-auto">
            The server didn’t answer. Check that it’s running, then try again.
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              setLoading(true);
              setLoadError(false);
              void fetchBooks();
            }}
          >
            <Icon name="refresh" size={14} />
            Retry
          </Button>
        </div>
      ) : books.length === 0 ? (
        <div className="relative mt-8 overflow-hidden rounded-[2rem] border border-white/[0.06] bg-gradient-to-b from-cinema-900/80 to-cinema-950/60 px-8 py-16 sm:px-14 sm:py-20 text-center shadow-elevated">
          <div className="pointer-events-none absolute inset-0 bg-mesh-gold opacity-80" />
          <div className="pointer-events-none absolute -top-20 left-1/2 h-48 w-72 -translate-x-1/2 rounded-full bg-gold-500/10 blur-3xl" />
          <div className="relative">
            <div className="mx-auto mb-8 flex h-16 w-16 items-center justify-center rounded-2xl border border-gold-500/20 bg-gradient-to-br from-gold-500/15 to-transparent text-gold-400 shadow-glow-sm">
              <Icon name="book" size={28} />
            </div>
            <h2 className="font-serif text-3xl sm:text-4xl font-medium tracking-tight text-gradient mb-3">
              Begin a performance
            </h2>
            <p className="text-cinema-400 text-sm sm:text-[15px] mb-10 leading-relaxed max-w-md mx-auto">
              Upload a DRM-free EPUB, search the stacks, or start with a classic.
            </p>
            <div className="flex flex-col gap-2 max-w-sm mx-auto">
              {CLASSICS.map((classic) => (
                <button
                  key={classic.title}
                  onClick={() => openClassic(classic)}
                  className="group flex items-center justify-between gap-3 rounded-xl border border-white/[0.05] bg-white/[0.02] px-4 py-3 text-left text-sm transition-all duration-300 hover:border-gold-500/25 hover:bg-gold-500/[0.06]"
                >
                  <span className="text-cinema-200">
                    <span className="text-cinema-400">{classic.author}</span>
                    <span className="mx-2 text-cinema-600">·</span>
                    <span className="font-serif italic text-cinema-100">{classic.title}</span>
                  </span>
                  <Icon
                    name="chevronRight"
                    size={14}
                    className="shrink-0 text-gold-500/70 transition-transform group-hover:translate-x-0.5"
                  />
                </button>
              ))}
            </div>
            <div className="mt-8">
              <Button variant="primary" onClick={() => setIsModalOpen(true)}>
                <Icon name="plus" size={16} />
                Add your own
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-5 gap-y-10">
          {books.map((book, i) => {
            const status = STATUS_TONE[book.status] ?? {
              tone: "cyan" as const,
              pulse: true,
              label: book.status,
            };
            return (
              <div
                key={book.id}
                onClick={() => onSelectBook(book.id)}
                style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                className="group cursor-pointer flex flex-col gap-3.5 animate-fade-up transition-transform duration-500 ease-out-expo hover:-translate-y-2"
              >
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
                      {/* Badge sits in flow here so it can never overlap the wordmark.
                          pl-8 on mobile reserves room for the always-visible delete button. */}
                      <div className="flex items-start justify-between gap-2 pl-8 sm:pl-0">
                        <div className="min-w-0 truncate pt-1 text-[9px] uppercase tracking-[0.2em] text-gold-400/80 font-medium">
                          Narratea
                        </div>
                        <div className="shrink-0 -mt-1 -mr-1">
                          <Badge tone={status.tone} pulse={status.pulse}>
                            {status.label}
                          </Badge>
                        </div>
                      </div>
                      <div className="font-serif text-[15px] font-medium line-clamp-4 leading-snug text-cinema-100">
                        {book.title}
                      </div>
                      <div className="text-xs text-cinema-400 line-clamp-1 italic font-serif">
                        {book.author}
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    aria-label={`Delete ${book.title}`}
                    onClick={(e) => handleDeleteBook(e, book.id, book.title)}
                    className="absolute top-2.5 left-2.5 z-10 opacity-0 group-hover:opacity-100 max-sm:opacity-100 transition-opacity w-9 h-9 rounded-full glass-strong text-cinema-300 hover:text-red-300 flex items-center justify-center"
                  >
                    <Icon name="x" size={14} />
                  </button>
                </div>

                <div className="px-0.5">
                  <h3 className="font-serif font-medium text-[15px] leading-snug line-clamp-2 transition-colors group-hover:text-gold-300">
                    {book.title}
                  </h3>
                  <p className="text-xs text-cinema-400 line-clamp-1 mt-1">{book.author}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Add a book">
        <div className="flex gap-1 p-1 rounded-2xl bg-cinema-950/80 border border-white/[0.05]">
          {ADD_MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              onClick={() => setAddMode(mode.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 text-xs px-3 py-2.5 rounded-xl font-semibold transition-all duration-200 ${
                addMode === mode.id
                  ? "bg-gradient-to-b from-gold-400 to-gold-500 text-cinema-950 shadow-glow-sm"
                  : "text-cinema-400 hover:text-white"
              }`}
            >
              <Icon name={mode.icon} size={14} />
              {mode.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleAddBook} className="space-y-4 pt-1">
          {addMode === "search" && (
            <>
              <div>
                <label className="label-caps mb-2 block">Title</label>
                <input
                  type="text"
                  required
                  maxLength={500}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Dracula"
                  className="input-field"
                />
              </div>
              <div>
                <label className="label-caps mb-2 block">Author</label>
                <input
                  type="text"
                  required
                  maxLength={500}
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  placeholder="e.g. Bram Stoker"
                  className="input-field"
                />
              </div>
            </>
          )}

          {addMode === "magnet" && (
            <div>
              <label className="label-caps mb-2 block">Magnet / hash</label>
              <input
                type="text"
                required
                maxLength={2048}
                value={magnet}
                onChange={(e) => setMagnet(e.target.value)}
                placeholder="magnet:?xt=urn:btih:…"
                className="input-field"
              />
            </div>
          )}

          {addMode === "file" && (
            <div>
              <label className="label-caps mb-2 block">EPUB file</label>
              <input
                type="file"
                required
                accept=".epub"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="input-field file:mr-3 file:rounded-lg file:border-0 file:bg-cinema-700 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-cinema-100 hover:file:bg-cinema-600"
              />
            </div>
          )}

          <Button type="submit" variant="primary" isLoading={submitting} className="w-full !mt-6">
            {submitting ? "Queuing…" : "Start performance"}
          </Button>
        </form>
      </Modal>
    </div>
  );
}
