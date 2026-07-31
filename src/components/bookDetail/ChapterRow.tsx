import { memo } from "react";
import { Badge } from "../ui/Badge";
import { formatDuration } from "../../lib/format";
import type { Chapter } from "../../types/api";

export const CHAPTER_STATUS: Record<
  Chapter["status"],
  { tone: "neutral" | "gold" | "cyan" | "emerald" | "red"; pulse: boolean; label: string }
> = {
  queued: { tone: "neutral", pulse: false, label: "Queued" },
  processing: { tone: "gold", pulse: true, label: "Performing" },
  partial_ready: { tone: "cyan", pulse: true, label: "Live" },
  ready: { tone: "emerald", pulse: false, label: "Ready" },
  failed: { tone: "red", pulse: false, label: "Failed" },
};

export interface ChapterRowProps {
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
export const ChapterRow = memo(function ChapterRow({ chapter: ch, progress, isActive, onSelect }: ChapterRowProps) {
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
