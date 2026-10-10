import type { ReactNode } from "react";
import { formatDurationWithHours } from "../../lib/format";
import type { Segment } from "../../types/api";
import { PlayerHeader } from "./PlayerHeader";
import { PlaybackSettings } from "./PlaybackSettings";
import { SegmentTranscript } from "./SegmentTranscript";
import { TransportControls, type PlayerTransportControls } from "./TransportControls";

interface PlayerExpandedPanelProps {
  bookTitle: string;
  chapterTitle: string;
  coverSrc?: string | null;
  isBufferingNext: boolean;
  segmentsList: Segment[];
  currentSegmentIndex: number;
  onSegmentSelect: (index: number) => void;
  onSegmentRedo: (segmentId: string) => void;
  playbackSpeed: number;
  onSpeedChange: (speed: number) => void;
  sleepPreset: number | null;
  sleepTimeLeft: number | null;
  onSleepChange: (value: string) => void;
  positionMs: number;
  totalDurationMs: number;
  onCollapse: () => void;
  transport: PlayerTransportControls;
  scrubber?: ReactNode;
}

export function PlayerExpandedPanel({
  bookTitle,
  chapterTitle,
  coverSrc,
  isBufferingNext,
  segmentsList,
  currentSegmentIndex,
  onSegmentSelect,
  onSegmentRedo,
  playbackSpeed,
  onSpeedChange,
  sleepPreset,
  sleepTimeLeft,
  onSleepChange,
  positionMs,
  totalDurationMs,
  onCollapse,
  transport,
  scrubber,
}: PlayerExpandedPanelProps) {
  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-4 pb-4 pt-5 animate-fade sm:px-6 sm:pb-6 sm:pt-6">
      <PlayerHeader
        bookTitle={bookTitle}
        chapterTitle={chapterTitle}
        coverSrc={coverSrc}
        isBufferingNext={isBufferingNext}
        onCollapse={onCollapse}
      />

      <SegmentTranscript
        segmentsList={segmentsList}
        currentSegmentIndex={currentSegmentIndex}
        onSegmentSelect={onSegmentSelect}
        onSegmentRedo={onSegmentRedo}
      />

      <div className="shrink-0 border-t border-line-hairline pt-4">
        <div className="mx-auto flex max-w-3xl items-center gap-3 font-mono text-caption tabular-nums text-ink-tertiary">
          <span className="w-16 text-ink-secondary">{formatDurationWithHours(positionMs)}</span>
          <div className="min-w-0 flex-1">{scrubber}</div>
          <span className="w-16 text-right">{formatDurationWithHours(totalDurationMs)}</span>
        </div>

        <div className="mt-4 flex flex-col items-center gap-4 md:grid md:grid-cols-3 md:gap-6">
          <div className="md:justify-self-start">
            <PlaybackSettings
              playbackSpeed={playbackSpeed}
              onSpeedChange={onSpeedChange}
              sleepPreset={sleepPreset}
              sleepTimeLeft={sleepTimeLeft}
              onSleepChange={onSleepChange}
            />
          </div>
          <div className="md:justify-self-center">
            <TransportControls variant="expanded" {...transport} />
          </div>
          <p className="hidden text-caption text-ink-tertiary md:block md:justify-self-end">
            <kbd className="rounded border border-line-strong bg-surface-2 px-1.5 py-0.5 font-mono text-micro text-ink-secondary">
              Space
            </kbd>{" "}
            play ·{" "}
            <kbd className="rounded border border-line-strong bg-surface-2 px-1.5 py-0.5 font-mono text-micro text-ink-secondary">← →</kbd>{" "}
            10s
          </p>
        </div>
      </div>
    </div>
  );
}
