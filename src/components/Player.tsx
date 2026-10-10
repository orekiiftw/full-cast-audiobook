import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { ProgressBar } from "./ui";
import {
  PlayerCollapsedBar,
  PlayerExpandedPanel,
  RegenerateLineModal,
  chapterDurationMs,
  isTextEntryTarget,
  playbackProgressPercent,
  useAudioPlayer,
  useLineRegeneration,
  usePlaybackPosition,
  useSegmentPlayback,
  voicedSharePercent,
  type PlayerTransportControls,
  type SegmentPlayback,
} from "./player";
import { audioUrl } from "../lib/audioUrl";
import { formatDurationWithHours } from "../lib/format";
import type { Book, Chapter, Segment } from "../types/api";

const SEEK_STEP_SECONDS = 10;

interface PlayerProps {
  book: Book;
  chapter: Chapter;
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  sleepPreset: number | null;
  setSleepPreset: (preset: number | null) => void;
  sleepTimeLeft: number | null;
  setSleepTimeLeft: (left: number | null) => void;
  playbackSpeed: number;
  setPlaybackSpeed: (speed: number) => void;
  positionRef: MutableRefObject<number>;
  segmentsList: Segment[];
  setSegmentsList: (segs: Segment[]) => void;
  currentSegmentIndex: number;
  setCurrentSegmentIndex: (idx: number) => void;
  initialPositionMs?: number;
  onChapterEnded?: () => void;
}

export function Player({
  book,
  chapter,
  isPlaying,
  setIsPlaying,
  sleepPreset,
  setSleepPreset,
  sleepTimeLeft,
  setSleepTimeLeft,
  playbackSpeed,
  setPlaybackSpeed,
  positionRef,
  segmentsList,
  setSegmentsList,
  currentSegmentIndex,
  setCurrentSegmentIndex,
  initialPositionMs = 0,
  onChapterEnded,
}: PlayerProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const segmentPlaybackRef = useRef<SegmentPlayback | null>(null);

  const position = usePlaybackPosition({ initialPositionMs, segmentsList, currentSegmentIndex, positionRef });

  const audio = useAudioPlayer({
    onEnded: () => segmentPlaybackRef.current?.handleSegmentEnded(),
    onTimeUpdate: position.handleSegmentProgress,
    onPlayBlocked: () => setIsPlaying(false),
  });

  const segmentPlayback = useSegmentPlayback({
    bookId: book.id,
    chapterId: chapter.id,
    segmentsList,
    setSegmentsList,
    currentSegmentIndex,
    setCurrentSegmentIndex,
    isPlaying,
    setIsPlaying,
    initialPositionMs,
    setPositionMs: position.setPositionMs,
    audio,
    onChapterEnded,
  });
  segmentPlaybackRef.current = segmentPlayback;

  const regeneration = useLineRegeneration({
    chapterId: chapter.id,
    setSegmentsList,
    restartSegmentIfActive: segmentPlayback.restartSegmentIfActive,
  });

  useEffect(() => {
    audio.setPlaybackRate(playbackSpeed);
  }, [audio, playbackSpeed]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTextEntryTarget(event.target) || regeneration.isModalOpen) return;
      if (event.repeat) return;
      if (event.code === "Space") {
        event.preventDefault();
        segmentPlayback.togglePlayPause();
      } else if (event.code === "ArrowRight") {
        event.preventDefault();
        segmentPlayback.seekBy(SEEK_STEP_SECONDS);
      } else if (event.code === "ArrowLeft") {
        event.preventDefault();
        segmentPlayback.seekBy(-SEEK_STEP_SECONDS);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [segmentPlayback.seekBy, segmentPlayback.togglePlayPause, regeneration.isModalOpen]);

  const handleSleepChange = (value: string) => {
    if (value === "") {
      setSleepPreset(null);
      setSleepTimeLeft(null);
      return;
    }
    const seconds = parseInt(value, 10);
    setSleepPreset(seconds);
    setSleepTimeLeft(seconds);
  };

  const transport: PlayerTransportControls = {
    canGoPrev: segmentPlayback.canGoPrev,
    canGoNext: segmentPlayback.canGoNext,
    goToPrev: segmentPlayback.goToPrev,
    goToNext: segmentPlayback.goToNext,
    togglePlayPause: segmentPlayback.togglePlayPause,
    isPlaying,
  };

  const totalDurationMs = chapterDurationMs(segmentsList);
  const progressPercent = playbackProgressPercent(position.positionMs, totalDurationMs);
  const bufferPercent = voicedSharePercent(segmentsList);

  const coverSrc = book.coverR2Key ? audioUrl(book.coverR2Key) : null;
  const scrubber = (
    <ProgressBar
      progress={progressPercent}
      buffered={bufferPercent}
      onSeek={segmentPlayback.seekToRatio}
      onStep={(direction) => segmentPlayback.seekBy(direction * SEEK_STEP_SECONDS)}
      label="Seek within chapter"
      valueText={`${formatDurationWithHours(position.positionMs)} of ${formatDurationWithHours(totalDurationMs)}`}
      formatPreview={(ratio) => formatDurationWithHours(ratio * totalDurationMs)}
    />
  );

  return (
    <section
      aria-label="Audio player"
      data-expanded={isExpanded}
      className={`player-dock chrome-glass fixed inset-x-0 bottom-0 z-dock border-t border-line-strong shadow-e-dock ${
        isExpanded ? "rounded-t-stage bg-surface-1" : ""
      }`}
    >
      {!isExpanded && (
        <div className="absolute inset-x-0 top-0 -translate-y-1/2 px-4 sm:px-6">
          <div className="mx-auto max-w-6xl">{scrubber}</div>
        </div>
      )}

      {isExpanded ? (
        <PlayerExpandedPanel
          bookTitle={book.title}
          chapterTitle={chapter.title}
          coverSrc={coverSrc}
          scrubber={scrubber}
          isBufferingNext={segmentPlayback.isBufferingNext}
          segmentsList={segmentsList}
          currentSegmentIndex={currentSegmentIndex}
          onSegmentSelect={segmentPlayback.goToSegment}
          onSegmentRedo={regeneration.openFor}
          playbackSpeed={playbackSpeed}
          onSpeedChange={setPlaybackSpeed}
          sleepPreset={sleepPreset}
          sleepTimeLeft={sleepTimeLeft}
          onSleepChange={handleSleepChange}
          positionMs={position.positionMs}
          totalDurationMs={totalDurationMs}
          onCollapse={() => setIsExpanded(false)}
          transport={transport}
        />
      ) : (
        <PlayerCollapsedBar
          bookTitle={book.title}
          chapterTitle={chapter.title}
          coverSrc={coverSrc}
          isPlayingUi={isPlaying && !segmentPlayback.isBufferingNext}
          isBufferingNext={segmentPlayback.isBufferingNext}
          positionMs={position.positionMs}
          totalDurationMs={totalDurationMs}
          onExpand={() => setIsExpanded(true)}
          transport={transport}
        />
      )}

      <RegenerateLineModal
        isOpen={regeneration.isModalOpen}
        instruction={regeneration.instruction}
        isRegenerating={regeneration.isRegenerating}
        onInstructionChange={regeneration.setInstruction}
        onClose={regeneration.close}
        onSubmit={regeneration.submit}
      />
    </section>
  );
}
