import { Icon } from "../ui";
import { formatDurationWithHours } from "../../lib/format";
import { TransportControls, type PlayerTransportControls } from "./TransportControls";

interface PlayerCollapsedBarProps {
  bookTitle: string;
  chapterTitle: string;
  isPlayingUi: boolean;
  isBufferingNext: boolean;
  positionMs: number;
  totalDurationMs: number;
  onExpand: () => void;
  transport: PlayerTransportControls;
}

export function PlayerCollapsedBar({
  bookTitle,
  chapterTitle,
  isPlayingUi,
  isBufferingNext,
  positionMs,
  totalDurationMs,
  onExpand,
  transport,
}: PlayerCollapsedBarProps) {
  return (
    <div className="max-w-6xl mx-auto px-5 sm:px-6 h-full flex items-center justify-between gap-4">
      <button className="flex items-center gap-3.5 min-w-0 text-left group flex-1" onClick={onExpand}>
        <div className="min-w-0">
          <span className="text-[10px] text-gold-400/90 uppercase tracking-[0.18em] truncate flex items-center gap-2 font-medium">
            {bookTitle}
            <span className={`eq text-gold-400 ${isPlayingUi ? "" : "eq-paused"}`} aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </span>
          <span className="font-serif text-[15px] font-medium block text-white truncate mt-0.5">{chapterTitle}</span>
        </div>
        <Icon name="chevronUp" size={16} className="text-cinema-500 shrink-0 transition-transform group-hover:-translate-y-0.5" />
      </button>

      <div className="flex items-center gap-4 sm:gap-5">
        {isBufferingNext && (
          <span className="text-[11px] text-gold-400 animate-pulse-soft hidden md:flex items-center gap-1.5 tracking-wide">
            <span className="w-1.5 h-1.5 rounded-full bg-gold-400 animate-ping" />
            Next line…
          </span>
        )}

        <TransportControls variant="collapsed" {...transport} />
      </div>

      <div className="hidden sm:flex items-center justify-end gap-4 flex-1">
        <span className="text-[11px] font-mono text-cinema-400 tabular-nums">
          {formatDurationWithHours(positionMs)}
          <span className="text-cinema-600 mx-1">/</span>
          {formatDurationWithHours(totalDurationMs)}
        </span>
      </div>
    </div>
  );
}
