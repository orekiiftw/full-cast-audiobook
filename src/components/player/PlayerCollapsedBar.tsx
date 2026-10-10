import { CoverArt, IconButton, LevelMeter, Spinner } from "../ui";
import { formatDurationWithHours } from "../../lib/format";
import { TransportControls, type PlayerTransportControls } from "./TransportControls";

interface PlayerCollapsedBarProps {
  bookTitle: string;
  chapterTitle: string;
  coverSrc?: string | null;
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
  coverSrc = null,
  isPlayingUi,
  isBufferingNext,
  positionMs,
  totalDurationMs,
  onExpand,
  transport,
}: PlayerCollapsedBarProps) {
  return (
    <div className="mx-auto flex h-full max-w-6xl items-center gap-3 px-4 sm:gap-6 sm:px-6">
      <button
        type="button"
        onClick={onExpand}
        aria-expanded={false}
        className="group flex min-w-0 flex-1 items-center gap-3 rounded-tile py-1 pr-2 text-left"
      >
        <CoverArt
          src={coverSrc}
          title={bookTitle}
          size="xs"
          className="aspect-cover w-9 shrink-0 rounded-md shadow-e-1 transition-transform duration-base ease-out-expo group-hover:-translate-y-0.5"
        />
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-2">
            <LevelMeter bars={3} active={isPlayingUi} className="h-2.5 shrink-0 text-gold-400" />
            <span className="eyebrow truncate text-gold-400">{bookTitle}</span>
          </span>
          <span className="mt-0.5 block truncate font-serif text-body-lg font-medium text-ink-primary">{chapterTitle}</span>
        </span>
        <span className="sr-only">, open the full player</span>
      </button>

      {isBufferingNext && (
        <span className="hidden shrink-0 items-center gap-1.5 text-caption text-gold-300 lg:flex" role="status">
          <Spinner size={12} />
          Next line…
        </span>
      )}

      <TransportControls variant="collapsed" {...transport} />

      <div className="hidden flex-1 items-center justify-end gap-3 sm:flex">
        <span className="font-mono text-caption tabular-nums text-ink-tertiary">
          <span className="text-ink-secondary">{formatDurationWithHours(positionMs)}</span>
          <span aria-hidden="true" className="mx-1">
            /
          </span>
          <span className="sr-only"> of </span>
          {formatDurationWithHours(totalDurationMs)}
        </span>
        <IconButton icon="chevronUp" label="Expand player" size="sm" onClick={onExpand} aria-expanded={false} />
      </div>
    </div>
  );
}
