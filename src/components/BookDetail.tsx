import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { Card } from "./ui/Card";
import { Skeleton } from "./ui/Skeleton";
import { Icon } from "./ui/Icon";
import { ChapterRow } from "./bookDetail/ChapterRow";
import { NarratorCard } from "./bookDetail/NarratorCard";
import { PronunciationEditor } from "./bookDetail/PronunciationEditor";
import { useToast } from "./ui/Toast";
import { useSSE } from "../hooks/useSSE";
import { apiFetch, deleteBook, reportNetworkError } from "../lib/api";
import type { Book, Chapter, PipelineEvent, BookDetailResponse } from "../types/api";

interface BookDetailProps {
  bookId: string;
  onBack: () => void;
  onPlayChapter: (book: Book, chapter: Chapter, resumeMs?: number) => void;
  activeChapterId?: string;
}

type DetailData = BookDetailResponse & {
  segmentProgress?: Record<string, { total: number; done: number }>;
  canRetry?: boolean;
};

export default function BookDetail({ bookId, onBack, onPlayChapter, activeChapterId }: BookDetailProps) {
  const { showToast } = useToast();
  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const [progressLog, setProgressLog] = useState<string[]>([]);
  const [segmentCountInfo, setSegmentCountInfo] = useState<Record<string, { total: number; done: number }>>({});

  const [newTerm, setNewTerm] = useState("");
  const [newHint, setNewHint] = useState("");
  const [addingPron, setAddingPron] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [playingPreviewId, setPlayingPreviewId] = useState<string | null>(null);
  /** Monotonic request counter — stale fetch responses are ignored so a slow older request can't
   * overwrite fresher data (or an unmounted view). */
  const fetchSeqRef = useRef(0);

  const fetchDetails = useCallback(async () => {
    const seq = ++fetchSeqRef.current;
    try {
      const res = await apiFetch(`/api/books/${bookId}`);
      if (seq !== fetchSeqRef.current) return; // superseded by a newer fetch
      if (res.status === 404) {
        setNotFound(true);
        setLoadError(false);
        return;
      }
      if (res.ok) {
        const body = (await res.json()) as DetailData;
        if (seq !== fetchSeqRef.current) return;
        setData(body);
        setLoadError(false);
        if (body.segmentProgress) {
          setSegmentCountInfo(body.segmentProgress);
        }
      } else if (res.status !== 401) {
        // Server error (5xx): show a retryable error, not "Book not found".
        setLoadError(true);
      }
    } catch (err) {
      console.error(err);
      if (seq === fetchSeqRef.current) setLoadError(true);
    } finally {
      if (seq === fetchSeqRef.current) setLoading(false);
    }
  }, [bookId]);

  const pushLog = useCallback((message: string) => {
    setProgressLog((prev) => [message, ...prev.slice(0, 14)]);
  }, []);

  const handlePipelineEvent = useCallback(
    (payload: PipelineEvent) => {
      if (payload.type === "progress_log") {
        pushLog(payload.message);
        return;
      }

      if (payload.type === "status_change") {
        setData((prev) => (prev ? { ...prev, book: { ...prev.book, status: payload.status } } : prev));
        pushLog(payload.message ?? `System status: ${payload.status}`);
        void fetchDetails();
        return;
      }

      if (payload.type === "chapter_status") {
        setData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            chapters: prev.chapters.map((ch) =>
              ch.id === payload.chapterId
                ? {
                    ...ch,
                    status: payload.status,
                    durationMs: payload.durationMs ?? ch.durationMs,
                    audioR2Key: payload.audioR2Key ?? ch.audioR2Key,
                  }
                : ch,
            ),
          };
        });
        return;
      }

      if (payload.type === "segment_failed") {
        pushLog(`Segment failed: ${payload.error}`);
        return;
      }

      if (payload.type === "quota_exceeded") {
        pushLog(payload.message ?? "TTS quota exhausted — generation paused.");
        return;
      }

      if (payload.type === "segment_ready") {
        const chapterId = payload.chapterId;
        // Producers always emit done/total counters with segment_ready.
        const eventDone = payload.done;
        const eventTotal = payload.total;

        setSegmentCountInfo((prev) => {
          const current = prev[chapterId] || { total: 0, done: 0 };
          const total = eventTotal > 0 ? eventTotal : current.total;
          const nextDone = eventDone;
          return {
            ...prev,
            [chapterId]: {
              total,
              done: total > 0 ? Math.min(total, nextDone) : nextDone,
            },
          };
        });
        setData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            chapters: prev.chapters.map((ch) => {
              if (ch.id !== chapterId) return ch;
              if (ch.status === "ready" || ch.status === "partial_ready" || ch.status === "failed") {
                return ch;
              }
              return { ...ch, status: "partial_ready" as Chapter["status"] };
            }),
          };
        });
      }
    },
    [pushLog, fetchDetails],
  );

  // Ref-stable row callback: identity never changes across data refreshes, so memoized
  // ChapterRows don't all re-render on every SSE event. Must live with the other hooks,
  // before the early returns below.
  const dataRef = useRef<DetailData | null>(null);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);
  const handleChapterSelect = useCallback(
    (ch: Chapter) => {
      const current = dataRef.current;
      if (!current) return;
      const resumeMs = current.playbackState?.chapterId === ch.id ? current.playbackState.positionMs : 0;
      onPlayChapter(current.book, ch, resumeMs);
    },
    [onPlayChapter],
  );

  useEffect(() => {
    fetchDetails();
  }, [fetchDetails]);

  useSSE(`/api/books/${bookId}/events`, {
    onEvent: handlePipelineEvent,
    onError: () => console.warn("SSE connection interrupted. Reconnecting…"),
    // Events emitted during the reconnect gap were missed — this view is SSE-only (no polling
    // fallback), so refetch or chapter rows stay stale until an unrelated event happens to arrive.
    onReconnect: () => void fetchDetails(),
  });

  useEffect(() => {
    return () => previewAudioRef.current?.pause();
  }, []);

  const handlePlayPreview = async (castId: string) => {
    if (playingPreviewId === castId) {
      previewAudioRef.current?.pause();
      setPlayingPreviewId(null);
      return;
    }

    try {
      setPlayingPreviewId(castId);
      previewAudioRef.current?.pause();

      const audio = new Audio(`/api/cast/${castId}/preview`);
      previewAudioRef.current = audio;
      audio.onended = () => {
        if (previewAudioRef.current === audio) setPlayingPreviewId(null);
      };
      audio.onerror = () => {
        if (previewAudioRef.current === audio) setPlayingPreviewId(null);
      };

      await audio.play();
    } catch (err) {
      console.error("Preview play failed:", err);
      setPlayingPreviewId(null);
      showToast("Failed to synthesize voice preview.", "error");
    }
  };

  useEffect(() => {
    if (!activeChapterId) return;
    previewAudioRef.current?.pause();
    setPlayingPreviewId(null);
  }, [activeChapterId]);

  const handleAddPronunciation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTerm || !newHint) return;
    setAddingPron(true);

    try {
      const res = await apiFetch(`/api/books/${bookId}/pronunciation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ term: newTerm, phoneticHint: newHint }),
      });

      if (res.ok) {
        setNewTerm("");
        setNewHint("");
        fetchDetails();
        showToast(`Pronunciation added for "${newTerm}".`);
      } else {
        showToast("Failed to save pronunciation.", "error");
      }
    } catch (err) {
      reportNetworkError(err, showToast);
    } finally {
      setAddingPron(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-5 sm:px-6 py-12 space-y-10">
        <Skeleton className="h-4 w-28 rounded-md" />
        <div className="flex gap-10 items-center">
          <Skeleton className="w-44 aspect-[2/3] rounded-2xl shimmer" />
          <div className="space-y-4 flex-1">
            <Skeleton className="h-10 w-2/3 rounded-md" />
            <Skeleton className="h-5 w-1/3 rounded-md" />
            <Skeleton className="h-7 w-24 rounded-full" />
          </div>
        </div>
        <Skeleton className="h-36 rounded-3xl shimmer" />
        <Skeleton className="h-72 rounded-3xl shimmer" />
      </div>
    );
  }

  if (loadError && !data?.book) {
    return (
      <div className="max-w-4xl mx-auto px-5 sm:px-6 py-20 text-center">
        <h1 className="font-serif text-3xl font-medium mb-3 text-gradient">Couldn’t load this book</h1>
        <p className="text-cinema-400 text-sm mb-8">The server hit an error. This is usually temporary — try again.</p>
        <div className="flex justify-center gap-3">
          <Button variant="secondary" onClick={onBack}>
            <Icon name="chevronLeft" size={16} />
            Back to Library
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setLoading(true);
              setLoadError(false);
              void fetchDetails();
            }}
          >
            <Icon name="refresh" size={14} />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (notFound || !data?.book) {
    return (
      <div className="max-w-4xl mx-auto px-5 sm:px-6 py-20 text-center">
        <h1 className="font-serif text-3xl font-medium mb-3 text-gradient">Book not found</h1>
        <p className="text-cinema-400 text-sm mb-8">This book may have been removed or the link is invalid.</p>
        <Button variant="secondary" onClick={onBack}>
          <Icon name="chevronLeft" size={16} />
          Back to Library
        </Button>
      </div>
    );
  }

  const book = data.book;
  // Single-narrator system: exactly one "cast" row exists per book (the Narrator inserted at
  // ingestion). Older books may carry several character rows; surface only the narrator, else
  // fall back to the first row so previews keep working for legacy libraries.
  const castList = data.cast ?? [];
  const narrator = castList.find((c) => c.name.toLowerCase() === "narrator") ?? castList[0] ?? null;
  const chaptersList = data.chapters ?? [];
  const pronList = data.pronunciation ?? [];
  const isWorking = book.status !== "ready" && book.status !== "failed";

  const handleRetry = async () => {
    setRetrying(true);
    try {
      const res = await apiFetch(`/api/books/${bookId}/retry`, { method: "POST" });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        showToast(body.error || "Retry failed.", "error");
        return;
      }
      showToast("Retrying performance pipeline…");
      setProgressLog([]);
      await fetchDetails();
    } catch (err) {
      reportNetworkError(err, showToast);
    } finally {
      setRetrying(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      if (await deleteBook(bookId, book.title, showToast)) onBack();
    } finally {
      setDeleting(false);
    }
  };

  const liveChapter =
    chaptersList.find((c) => c.status === "partial_ready") ||
    chaptersList.find((c) => c.status === "ready") ||
    chaptersList.find((c) => {
      const p = segmentCountInfo[c.id];
      return (c.status === "processing" || c.status === "queued") && !!p && p.done > 0;
    });

  return (
    <div className="max-w-4xl mx-auto px-5 sm:px-6 py-10 sm:py-12 animate-fade-up">
      <button
        onClick={onBack}
        className="label-caps text-cinema-400 hover:text-gold-300 mb-10 transition-colors flex items-center gap-1.5 group"
      >
        <Icon name="chevronLeft" size={14} className="transition-transform group-hover:-translate-x-0.5" />
        Library
      </button>

      <div className="relative flex flex-col sm:flex-row gap-10 items-start mb-16">
        <div className="pointer-events-none absolute -left-16 -top-10 h-56 w-56 rounded-full bg-gold-500/10 blur-3xl" />

        <div className="cover-frame relative w-44 shrink-0 aspect-[2/3] rounded-2xl overflow-hidden shadow-cover ring-1 ring-white/10 self-center sm:self-start">
          {book.coverR2Key ? (
            <img src={`/api/audio?key=${encodeURIComponent(book.coverR2Key)}`} alt={book.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-cinema-800 via-cinema-900 to-cinema-950 p-5 flex flex-col justify-between text-center">
              <div className="text-[9px] uppercase tracking-[0.28em] font-medium text-gold-400/80">Narratea</div>
              <div className="font-serif text-sm font-medium line-clamp-4 leading-snug">{book.title}</div>
              <div className="text-[10px] text-cinema-400 italic font-serif">{book.author}</div>
            </div>
          )}
        </div>

        <div className="relative flex-1 text-center sm:text-left space-y-6 w-full">
          <div>
            <h1 className="font-serif text-3xl sm:text-4xl md:text-5xl font-medium tracking-tight mb-3 text-balance text-gradient leading-[1.1]">
              {book.title}
            </h1>
            <p className="text-cinema-400 text-lg italic font-serif">by {book.author}</p>
          </div>

          <div className="flex justify-center sm:justify-start items-center gap-3 flex-wrap">
            <Badge tone={book.status === "ready" ? "emerald" : book.status === "failed" ? "red" : "gold"} pulse={isWorking}>
              {book.status}
            </Badge>
            <span className="text-[11px] text-cinema-500 tracking-wide">
              {chaptersList.length} chapters
              <span className="mx-1.5 text-cinema-700">·</span>
              Voiced by {narrator?.ttsVoiceName ?? "Mia"}
              <span className="mx-1.5 text-cinema-700">·</span>
              {pronList.length} guides
            </span>
          </div>

          {book.status === "failed" && (
            <div className="flex flex-wrap justify-center sm:justify-start gap-2.5">
              {(data.canRetry || book.epubR2Key) && (
                <Button variant="primary" size="sm" isLoading={retrying} onClick={handleRetry}>
                  <Icon name="refresh" size={14} />
                  Retry
                </Button>
              )}
              <Button variant="danger" size="sm" isLoading={deleting} onClick={handleDelete}>
                <Icon name="x" size={14} />
                Delete
              </Button>
            </div>
          )}

          {liveChapter && activeChapterId !== liveChapter.id && (
            <div className="flex flex-wrap justify-center sm:justify-start gap-4 items-center pt-1">
              <Button variant="primary" size="lg" onClick={() => handleChapterSelect(liveChapter)}>
                <Icon name="play" size={16} />
                Listen live
              </Button>
              <span className="text-xs text-cinema-400">
                {segmentCountInfo[liveChapter.id]
                  ? `${segmentCountInfo[liveChapter.id].done}/${segmentCountInfo[liveChapter.id].total} lines`
                  : "Stream as lines finish"}
                <span className="mx-1.5 text-cinema-600">·</span>
                Ch. {liveChapter.chapterIndex}
              </span>
            </div>
          )}
        </div>
      </div>

      {isWorking && (
        <Card className="p-5 mb-12 overflow-hidden relative">
          <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gold-500/10 blur-2xl" />
          <h3 className="label-caps text-gold-400 mb-4 flex items-center gap-2">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold-400 opacity-50" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-gold-400" />
            </span>
            Studio console
          </h3>
          <div className="font-mono text-[11px] text-cinema-400 max-h-28 overflow-y-auto space-y-1.5 pr-2">
            {progressLog.length === 0 ? (
              // A just-added book is enqueued before this view (and its SSE stream) opens, so the
              // first progress events can be missed — derive a status-based line instead of waiting.
              <p className="italic text-cinema-600">
                {book.status === "discovering" ? "Starting up — acquisition and parsing updates land here shortly…" : "Waiting for cues…"}
              </p>
            ) : (
              progressLog.map((log, index) => {
                const isError = /fail|error|quota|⛔|❌/i.test(log);
                const isWarning = /warn|⚠️/i.test(log);
                return (
                  <div key={index} className="flex gap-2">
                    <span className="text-gold-600/80 select-none">›</span>
                    <span className={isError ? "text-red-300" : isWarning ? "text-amber-300" : undefined}>{log}</span>
                  </div>
                );
              })
            )}
          </div>
        </Card>
      )}

      {narrator && <NarratorCard narrator={narrator} playingPreviewId={playingPreviewId} onPlayPreview={handlePlayPreview} />}

      <section className="mb-14">
        <div className="flex items-baseline justify-between pb-4 mb-5 border-b border-white/[0.05]">
          <h2 className="font-serif text-2xl font-medium tracking-tight">Chapters</h2>
          <span className="label-caps">
            {chaptersList.filter((c) => c.status === "ready").length}/{chaptersList.length} ready
          </span>
        </div>
        <div className="space-y-2">
          {chaptersList.map((ch) => (
            <ChapterRow
              key={ch.id}
              chapter={ch}
              progress={segmentCountInfo[ch.id]}
              isActive={activeChapterId === ch.id}
              onSelect={handleChapterSelect}
            />
          ))}
        </div>
      </section>

      <PronunciationEditor
        pronList={pronList}
        newTerm={newTerm}
        newHint={newHint}
        addingPron={addingPron}
        onNewTermChange={setNewTerm}
        onNewHintChange={setNewHint}
        onSubmit={handleAddPronunciation}
      />
    </div>
  );
}
