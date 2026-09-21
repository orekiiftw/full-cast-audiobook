import { formatDurationWithHours } from "../../lib/format";
import type { Segment } from "../../types/api";
import { PlayerHeader } from "./PlayerHeader";
import { PlaybackSettings } from "./PlaybackSettings";
import { SegmentTranscript } from "./SegmentTranscript";
import { TransportControls, type PlayerTransportControls } from "./TransportControls";

interface PlayerExpandedPanelProps {
  bookTitle: string;
  chapterTitle: string;
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
}

export function PlayerExpandedPanel({
  bookTitle,
  chapterTitle,
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
}: PlayerExpandedPanelProps) {
  return (
    <div className="h-full flex flex-col p-5 sm:p-7 max-w-6xl mx-auto w-full animate-fade-in pt-6">
      <PlayerHeader bookTitle={bookTitle} chapterTitle={chapterTitle} isBufferingNext={isBufferingNext} onCollapse={onCollapse} />

      <SegmentTranscript
        segmentsList={segmentsList}
        currentSegmentIndex={currentSegmentIndex}
        onSegmentSelect={onSegmentSelect}
        onSegmentRedo={onSegmentRedo}
      />

      <div className="flex flex-col md:flex-row justify-between items-center gap-5 pt-4 border-t border-white/[0.05]">
        <PlaybackSettings
          playbackSpeed={playbackSpeed}
          onSpeedChange={onSpeedChange}
          sleepPreset={sleepPreset}
          sleepTimeLeft={sleepTimeLeft}
          onSleepChange={onSleepChange}
        />

        <div className="flex items-center gap-5">
          <TransportControls variant="expanded" {...transport} />
        </div>

        <div className="text-[11px] font-mono text-cinema-400 tabular-nums">
          {formatDurationWithHours(positionMs)}
          <span className="text-cinema-600 mx-1">/</span>
          {formatDurationWithHours(totalDurationMs)}
        </div>
      </div>
    </div>
  );
}
