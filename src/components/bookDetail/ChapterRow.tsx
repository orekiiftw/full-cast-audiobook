import { memo } from "react";
import { Badge, Icon, LevelMeter, type BadgeTone } from "../ui";
import { formatDuration } from "../../lib/format";
import type { Chapter } from "../../types/api";

const CHAPTER_STATUS: Record<Chapter["status"], { tone: BadgeTone; pulse: boolean; label: string } | null> = {
  queued: { tone: "neutral", pulse: false, label: "Queued" },
  processing: { tone: "gold", pulse: true, label: "Performing" },
  partial_ready: { tone: "emerald", pulse: true, label: "Live" },
  ready: null,
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
  const isGenerating = chapter.status === "processing" || chapter.status === "partial_ready";
  const progressRatio = progress && progress.total > 0 ? Math.min(1, progress.done / progress.total) : 0;

  return (
    <li>
      <button
        type="button"
        disabled={!isPlayable}
        aria-current={isActive ? "true" : undefined}
        onClick={() => isPlayable && onSelect(chapter)}
        className={`group relative flex w-full items-center gap-4 overflow-hidden rounded-tile border px-4 py-3.5 text-left transition-colors duration-base ease-standard disabled:cursor-not-allowed sm:gap-5 sm:px-5 sm:py-4 ${chapterRowStateClass(
          isActive,
          isPlayable,
        )}`}
      >
        <span
          className={`w-7 shrink-0 self-start pt-0.5 font-mono text-caption tabular-nums ${isActive ? "text-gold-300" : "text-ink-tertiary"}`}
        >
          {chapter.chapterIndex.toString().padStart(2, "0")}
        </span>

        <ChapterRowDetails chapter={chapter} progress={progress} hasVoicedLines={hasVoicedLines} isActive={isActive} />

        <span
          aria-hidden="true"
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-colors duration-base ${
            isActive
              ? "border-transparent bg-gold-300 text-ink-inverse shadow-accent-press"
              : isPlayable
                ? "border-line-accent text-gold-300 group-hover:border-transparent group-hover:bg-gold-300 group-hover:text-ink-inverse"
                : "border-line-hairline text-ink-disabled"
          }`}
        >
          {isActive ? (
            <LevelMeter bars={3} className="h-3.5" />
          ) : (
            <Icon name={isPlayable ? "play" : chapter.status === "failed" ? "alert" : "clock"} size={16} />
          )}
        </span>
        {!isActive && <span className="sr-only">{isPlayable ? "Play chapter" : "Not yet available to play"}</span>}

        {isGenerating && progressRatio > 0 && (
          <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 bg-ink-primary/5">
            <span
              className="block h-full origin-left bg-gold-400/70 transition-transform duration-slow ease-out-expo"
              style={{ transform: `scaleX(${progressRatio})` }}
            />
          </span>
        )}
      </button>
    </li>
  );
});

interface ChapterRowDetailsProps {
  chapter: Chapter;
  progress: { total: number; done: number } | undefined;
  hasVoicedLines: boolean;
  isActive: boolean;
}

function ChapterRowDetails({ chapter, progress, hasVoicedLines, isActive }: ChapterRowDetailsProps) {
  const status =
    chapter.status in CHAPTER_STATUS ? CHAPTER_STATUS[chapter.status] : { tone: "neutral" as const, pulse: false, label: chapter.status };
  const progressText = progress ? `${progress.done}/${progress.total || "?"} lines` : null;

  return (
    <span className="min-w-0 flex-1">
      <span
        className={`block break-words font-serif text-body-lg font-medium ${isActive ? "text-gold-100" : chapter.status === "ready" || chapter.status === "partial_ready" ? "text-ink-primary" : "text-ink-secondary"}`}
      >
        {chapter.title}
      </span>
      <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-caption text-ink-tertiary">
        {status && (
          <Badge tone={status.tone} pulse={status.pulse}>
            {status.label}
          </Badge>
        )}
        {chapter.status === "ready" || chapter.durationMs != null ? (
          <span className="font-mono tabular-nums">{formatDuration(chapter.durationMs)}</span>
        ) : null}
        {chapter.status === "processing" && (
          <span className="tabular-nums text-gold-300">
            {hasVoicedLines ? "Listen live" : "Voicing"}
            {progressText ? ` · ${progressText}` : "…"}
          </span>
        )}
        {chapter.status === "partial_ready" && progressText && <span className="tabular-nums text-success-300">{progressText} ready</span>}
        {isActive && <span className="font-semibold text-gold-300">Now playing</span>}
      </span>
    </span>
  );
}

function chapterRowStateClass(isActive: boolean, isPlayable: boolean): string {
  if (isActive) return "border-line-accent bg-gold-500/10";
  if (isPlayable) return "border-line-hairline bg-surface-2 hover:border-line-strong hover:bg-surface-3";
  return "border-line-hairline bg-surface-1";
}
