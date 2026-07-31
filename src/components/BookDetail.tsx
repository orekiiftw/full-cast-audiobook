import { useState, useEffect, useRef, useCallback, memo } from "react";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { Card } from "./ui/Card";
import { Skeleton } from "./ui/Skeleton";
import { Icon } from "./ui/Icon";
import { useToast } from "./ui/Toast";
import { useSSE } from "../hooks/useSSE";
import { apiFetch, reportNetworkError } from "../lib/api";
import { formatDuration } from "../lib/format";
import type {
  Book,
  Chapter,
  PipelineEvent,
  PronunciationTerm,
  BookDetailResponse,
} from "../types/api";

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

const CHAPTER_STATUS: Record<
  Chapter["status"],
  { tone: "neutral" | "gold" | "cyan" | "emerald" | "red"; pulse: boolean; label: string }
> = {
  queued: { tone: "neutral", pulse: false, label: "Queued" },
  processing: { tone: "gold", pulse: true, label: "Performing" },
  partial_ready: { tone: "cyan", pulse: true, label: "Live" },
  ready: { tone: "emerald", pulse: false, label: "Ready" },
  failed: { tone: "red", pulse: false, label: "Failed" },
};

interface ChapterRowProps {
  chapter: Chapter;
  progress: { total: number; done: number } | undefined;
  isActive: boolean;
  onSelect: (chapter: Chapter) => void;
}

/**
 * Memoized so segment_ready SSE bursts (one setState per event, several per
 * second with concurrent workers) only re-render rows whose own data changed
 * instead of the whole chapter list every event.
 */
const ChapterRow = memo(function ChapterRow({ chapter: ch, progress, isActive, onSelect }: ChapterRowProps) {
  const hasVoicedLines = !!progress && progress.done > 0;
  const isPlayable =
    ch.status === "ready" ||
    ch.status === "partial_ready" ||
    (hasVoicedLines && (ch.status === "processing" || ch.status === "queued"));
  const status = CHAPTER_STATUS[ch.status];
  const progressPct =
    progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0;

  return (
    <div
      onClick={() => isPlayable && onSelect(ch)}
      className={`relative rounded-2xl p-4 flex justify-between items-center gap-4 transition-all duration-300 overflow-hidden border ${
        isPlayable
          ? "border-white/[0.05] bg-cinema-900/30 hover:bg-cinema-900/55 hover:border-white/[0.09] cursor-pointer"
          : "border-white/[0.03] opacity-50"
      } ${isActive ? "ring-1 ring-gold-500/35 bg-gold-500/[0.06] border-gold-500/20" : ""}`}
    >
      {ch.status === "processing" && progressPct > 0 && (
        <div
          className="absolute inset-y-0 left-0 bg-gold-500/[0.07] transition-all duration-500"
          style={{ width: `${progressPct}%` }}
        />
      )}

      <div className="flex-1 min-w-0 pr-2 relative">
        <div className="flex items-center gap-3.5">
          <span className="font-mono text-[11px] text-gold-500/90 tabular-nums shrink-0 w-6">
            {ch.chapterIndex.toString().padStart(2, "0")}
          </span>
          <h4
            className={`font-serif text-[15px] font-medium truncate ${
              isActive ? "text-gold-300" : "text-cinema-100"
            }`}
          >
            {ch.title}
          </h4>
        </div>
        {ch.status === "processing" && (
          <p className="text-[10px] text-gold-400/80 mt-1.5 ml-9 tracking-wide">
            {hasVoicedLines ? "Live · " : "Performing · "}
            {progress ? `${progress.done}/${progress.total || "?"}` : "…"}
          </p>
        )}
        {ch.status === "partial_ready" && (
          <p className="text-[10px] text-sky-300/90 mt-1.5 ml-9 tracking-wide">
            Listen live
            {progress ? ` · ${progress.done}/${progress.total || "?"} ready` : ""}
          </p>
        )}
        {isActive && (
          <p className="text-[10px] text-gold-400 mt-1.5 ml-9 tracking-wide flex items-center gap-2">
            <span className="eq text-gold-400" aria-hidden="true">
              <span /><span /><span />
            </span>
            Now playing
          </p>
        )}
      </div>

      <div className="flex items-center gap-3.5 relative shrink-0">
        <span className="font-mono text-[11px] text-cinema-500 tabular-nums hidden sm:block">
          {formatDuration(ch.durationMs)}
        </span>
        <Badge tone={status.tone} pulse={status.pulse}>
          {status.label}
        </Badge>
      </div>
    </div>
  );
});

export default function BookDetail({ bookId, onBack, onPlayChapter, activeChapterId }: BookDetailProps) {
  const { showToast } = useToast();
  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const [progressLog, setProgressLog] = useState<string[]>([]);
  const [segmentCountInfo, setSegmentCountInfo] = useState<
    Record<string, { total: number; done: number }>
  >({});

  const [newTerm, setNewTerm] = useState("");
  const [newHint, setNewHint] = useState("");
  const [addingPron, setAddingPron] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [playingPreviewId, setPlayingPreviewId] = useState<string | null>(null);
  /** Monotonic request counter — stale fetch responses are ignored so a slow
   * older request can never overwrite fresher data (or an unmounted view). */
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
        // Server error (5xx etc.): show a retryable error, not "Book not found"
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
        setData((prev) =>
          prev ? { ...prev, book: { ...prev.book, status: payload.status } } : prev
        );
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
                : ch
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
    [pushLog, fetchDetails]
  );

  // Ref-stable row callback: identity never changes across data refreshes, so
  // memoized ChapterRows don't all re-render on every SSE event.
  // (Must live with the other hooks, before the early returns below.)
  const dataRef = useRef<DetailData | null>(null);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);
  const handleChapterSelect = useCallback(
    (ch: Chapter) => {
      const current = dataRef.current;
      if (!current) return;
      const resumeMs =
        current.playbackState?.chapterId === ch.id ? current.playbackState.positionMs : 0;
      onPlayChapter(current.book, ch, resumeMs);
    },
    [onPlayChapter]
  );

  useEffect(() => {
    fetchDetails();
  }, [fetchDetails]);

  useSSE(`/api/books/${bookId}/events`, {
    onEvent: handlePipelineEvent,
    onError: () => console.warn("SSE connection interrupted. Reconnecting…"),
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
        <p className="text-cinema-400 text-sm mb-8">
          The server hit an error. This is usually temporary — try again.
        </p>
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
        <p className="text-cinema-400 text-sm mb-8">
          This book may have been removed or the link is invalid.
        </p>
        <Button variant="secondary" onClick={onBack}>
          <Icon name="chevronLeft" size={16} />
          Back to Library
        </Button>
      </div>
    );
  }

  const book = data.book;
  // Single-narrator system: exactly one "cast" row exists per book (the
  // Narrator inserted at ingestion). Older books may still carry several
  // character rows; we surface only the narrator, else fall back to the
  // first row so previews keep working for legacy libraries.
  const castList = data.cast ?? [];
  const narrator =
    castList.find((c) => c.name.toLowerCase() === "narrator") ?? castList[0] ?? null;
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
    if (!window.confirm(`Delete "${book.title}" from your library?`)) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/books/${bookId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        showToast(body.error || "Delete failed.", "error");
        return;
      }
      showToast("Book deleted.");
      onBack();
    } catch (err) {
      reportNetworkError(err, showToast);
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
            <img
              src={`/api/audio?key=${encodeURIComponent(book.coverR2Key)}`}
              alt={book.title}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-cinema-800 via-cinema-900 to-cinema-950 p-5 flex flex-col justify-between text-center">
              <div className="text-[9px] uppercase tracking-[0.28em] font-medium text-gold-400/80">
                Narratea
              </div>
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
            <Badge
              tone={book.status === "ready" ? "emerald" : book.status === "failed" ? "red" : "gold"}
              pulse={isWorking}
            >
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
              <p className="italic text-cinema-600">Waiting for cues…</p>
            ) : (
              progressLog.map((log, index) => {
                const isError = /fail|error|quota|⛔|❌/i.test(log);
                const isWarning = /warn|⚠️/i.test(log);
                return (
                  <div key={index} className="flex gap-2">
                    <span className="text-gold-600/80 select-none">›</span>
                    <span
                      className={
                        isError ? "text-red-300" : isWarning ? "text-amber-300" : undefined
                      }
                    >
                      {log}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </Card>
      )}

      {narrator && (
        <section className="mb-14">
          <div className="flex items-baseline justify-between pb-4 mb-5 border-b border-white/[0.05]">
            <h2 className="font-serif text-2xl font-medium tracking-tight">Narration</h2>
            <span className="label-caps">Single narrator</span>
          </div>
          <Card className="p-4 flex justify-between items-center gap-4" isInteractive>
            <div className="min-w-0">
              <h4 className="font-serif text-[15px] font-medium truncate">
                {narrator.name}
                <span className="ml-2 text-[11px] font-sans font-normal text-gold-400/90 uppercase tracking-[0.14em]">
                  {narrator.ttsVoiceName}
                </span>
              </h4>
              <p className="text-[11px] text-cinema-400 mt-1 tracking-wide">
                Voices every character &amp; narration
              </p>
              <p className="text-[11px] text-cinema-500 mt-1.5 italic line-clamp-1 font-serif">
                “{narrator.styleString}”
              </p>
            </div>
            <button
              onClick={() => handlePlayPreview(narrator.id)}
              aria-label={`Preview narrator voice ${narrator.ttsVoiceName}`}
              className={`w-10 h-10 shrink-0 rounded-full border flex items-center justify-center transition-all duration-300 ${
                playingPreviewId === narrator.id
                  ? "border-gold-400/50 bg-gold-500/15 text-gold-300 shadow-glow-sm"
                  : "border-white/[0.08] text-gold-400 hover:border-gold-500/40 hover:bg-gold-500/10"
              }`}
            >
              <Icon name={playingPreviewId === narrator.id ? "pause" : "play"} size={14} />
            </button>
          </Card>
        </section>
      )}

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

      <Card className="p-6 sm:p-7">
        <h2 className="font-serif text-xl font-medium tracking-tight mb-2">Phonetic dictionary</h2>
        <p className="text-xs text-cinema-400 mb-6 leading-relaxed max-w-lg">
          Guide how names and invented words should sound. Hints are woven into the performance prompts.
        </p>

        {pronList.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
            {pronList.map((p: PronunciationTerm) => (
              <span
                key={p.id}
                className="text-xs px-3 py-1.5 rounded-full bg-cinema-950/60 border border-white/[0.06] flex gap-2"
              >
                <span className="font-medium text-cinema-100">{p.term}</span>
                <span className="text-cinema-600">→</span>
                <span className="italic text-gold-400 font-mono">{p.phoneticHint}</span>
              </span>
            ))}
          </div>
        )}

        <form onSubmit={handleAddPronunciation} className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            required
            maxLength={200}
            placeholder="Term (e.g. Cthulhu)"
            value={newTerm}
            onChange={(e) => setNewTerm(e.target.value)}
            className="input-field flex-1 !text-xs"
          />
          <input
            type="text"
            required
            maxLength={200}
            placeholder="Hint (e.g. kuh-THOO-loo)"
            value={newHint}
            onChange={(e) => setNewHint(e.target.value)}
            className="input-field flex-1 !text-xs"
          />
          <Button type="submit" variant="secondary" size="sm" isLoading={addingPron}>
            Add
          </Button>
        </form>
      </Card>
    </div>
  );
}
