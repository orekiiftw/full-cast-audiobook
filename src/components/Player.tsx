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
import type { Book, Chapter, Segment } from "../types/api";

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
        segmentPlayback.seekBy(10);
      } else if (event.code === "ArrowLeft") {
        event.preventDefault();
        segmentPlayback.seekBy(-10);
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

  return (
    <div
      className={`player-sheet fixed bottom-0 left-0 right-0 z-50 shadow-player glass-strong transition-all duration-500 ease-out-expo ${
        isExpanded ? "player-sheet--expanded rounded-t-[1.75rem]" : ""
      }`}
    >
      <div className="absolute top-0 left-0 right-0 px-4 sm:px-6 -translate-y-1/2">
        <div className="max-w-6xl mx-auto">
          <ProgressBar progress={progressPercent} buffered={bufferPercent} onSeek={segmentPlayback.seekToRatio} />
        </div>
      </div>

      {isExpanded ? (
        <PlayerExpandedPanel
          bookTitle={book.title}
          chapterTitle={chapter.title}
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
    </div>
  );
}
