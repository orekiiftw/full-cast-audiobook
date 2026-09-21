import { memo } from "react";
import { Badge, Icon } from "../ui";
import { formatDuration } from "../../lib/format";
import type { Chapter } from "../../types/api";

const CHAPTER_STATUS: Record<Chapter["status"], { tone: "neutral" | "gold" | "cyan" | "emerald" | "red"; pulse: boolean; label: string }> =
  {
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

export const ChapterRow = memo(function ChapterRow({ chapter, progress, isActive, onSelect }: ChapterRowProps) {
  const hasVoicedLines = !!progress && progress.done > 0;
  const isPlayable =
    chapter.status === "ready" ||
    chapter.status === "partial_ready" ||
    (hasVoicedLines && (chapter.status === "processing" || chapter.status === "queued"));
  const progressPct = progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0;

  return (
    <button
      type="button"
      disabled={!isPlayable}
      aria-current={isActive ? "true" : undefined}
      onClick={() => isPlayable && onSelect(chapter)}
      className={`group relative grid w-full grid-cols-[1.5rem_minmax(0,1fr)_2.75rem] items-center gap-3 rounded-xl border p-4 text-left transition-colors sm:gap-4 sm:p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-cinema-950 disabled:cursor-not-allowed ${chapterRowStateClass(
        isActive,
        isPlayable,
      )}`}
    >
      {chapter.status === "processing" && progressPct > 0 && (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 rounded-xl bg-gold-500/[0.05] transition-all duration-500"
          style={{ width: `${progressPct}%` }}
        />
      )}

      <span className="relative self-start pt-1 font-mono text-xs text-cinema-400 tabular-nums">
        {chapter.chapterIndex.toString().padStart(2, "0")}
      </span>

      <ChapterRowDetails chapter={chapter} progress={progress} hasVoicedLines={hasVoicedLines} isActive={isActive} />

      <span
        aria-hidden="true"
        className={`relative flex h-11 w-11 items-center justify-center rounded-full border ${isPlayable ? "border-gold-500/30 text-gold-300 group-hover:bg-gold-500/10" : "border-cinema-700 text-cinema-500"}`}
      >
        <Icon name="play" size={16} />
      </span>
      <span className="sr-only">{isPlayable ? "Play chapter" : "Not yet available to play"}</span>
    </button>
  );
});

interface ChapterRowDetailsProps {
  chapter: Chapter;
  progress: { total: number; done: number } | undefined;
  hasVoicedLines: boolean;
  isActive: boolean;
}

function ChapterRowDetails({ chapter, progress, hasVoicedLines, isActive }: ChapterRowDetailsProps) {
  return (
    <span className="relative min-w-0">
      <span className={`block break-words font-serif text-lg leading-snug ${isActive ? "text-gold-100" : "text-cinema-100"}`}>
        {chapter.title}
      </span>
      <ChapterRowMeta chapter={chapter} />
      <ChapterRowNotice chapter={chapter} progress={progress} hasVoicedLines={hasVoicedLines} isActive={isActive} />
    </span>
  );
}

function ChapterRowMeta({ chapter }: { chapter: Chapter }) {
  const status = CHAPTER_STATUS[chapter.status] ?? { tone: "neutral" as const, pulse: false, label: chapter.status };

  return (
    <span className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
      <Badge tone={status.tone === "cyan" ? "gold" : status.tone} pulse={status.pulse}>
        {status.label}
      </Badge>
      <span className="font-mono text-xs text-cinema-400 tabular-nums">{formatDuration(chapter.durationMs)}</span>
    </span>
  );
}

interface ChapterRowNoticeProps {
  chapter: Chapter;
  progress: { total: number; done: number } | undefined;
  hasVoicedLines: boolean;
  isActive: boolean;
}

function ChapterRowNotice({ chapter, progress, hasVoicedLines, isActive }: ChapterRowNoticeProps) {
  return (
    <>
      {chapter.status === "processing" && (
        <span className="mt-2 block text-xs text-gold-300">
          {hasVoicedLines ? "Live · " : "Performing · "}
          {progress ? `${progress.done}/${progress.total || "?"}` : "…"}
        </span>
      )}
      {chapter.status === "partial_ready" && (
        <span className="mt-2 block text-xs text-gold-300">
          Listen live
          {progress ? ` · ${progress.done}/${progress.total || "?"} ready` : ""}
        </span>
      )}
      {isActive && (
        <span className="mt-2 flex items-center gap-2 text-xs text-gold-300">
          <span className="eq text-gold-400" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          Now playing
        </span>
      )}
    </>
  );
}

function chapterRowStateClass(isActive: boolean, isPlayable: boolean): string {
  if (isActive) return "border-gold-500/50 bg-gold-500/[0.07]";
  if (isPlayable) return "border-cinema-700 bg-cinema-900 hover:border-gold-500/40 hover:bg-cinema-850";
  return "border-cinema-800 bg-cinema-950";
}
