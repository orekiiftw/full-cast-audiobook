import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Icon, Spinner } from "../ui";
import { isPendingStatus, isPlayableSegment } from "../../lib/segmentStatus";
import type { Segment } from "../../types/api";

// After the listener scrolls the transcript by hand, following the active line pauses this long
// so their reading position isn't yanked away mid-scroll.
const MANUAL_SCROLL_GRACE_MS = 5000;
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"]);

interface SegmentRowProps {
  seg: Segment;
  index: number;
  isActive: boolean;
  onSelect: (idx: number) => void;
  onRedo: (segId: string) => void;
  registerRef: (id: string, el: HTMLLIElement | null) => void;
}

const SegmentRow = memo(function SegmentRow({ seg, index, isActive, onSelect, onRedo, registerRef }: SegmentRowProps) {
  const playable = isPlayableSegment(seg);
  const failed = seg.status === "failed";

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    // Keeps the player's global Space shortcut from also toggling playback.
    event.stopPropagation();
    if (playable) onSelect(index);
  };

  return (
    <li
      ref={(el) => registerRef(seg.id, el)}
      onClick={() => playable && onSelect(index)}
      className={`group relative flow-root rounded-tile border px-4 py-3.5 transition-colors duration-base ease-standard sm:px-5 ${
        playable ? "cursor-pointer" : ""
      } ${isActive ? "border-line-accent bg-gold-500/10" : "border-transparent hover:bg-surface-2"}`}
    >
      {playable && (
        <div
          className={`float-right mb-1.5 ml-3 transition-opacity duration-base ${
            isActive ? "opacity-100" : "opacity-0 focus-within:opacity-100 group-hover:opacity-100 touch:opacity-100"
          }`}
        >
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onRedo(seg.id);
            }}
            aria-label={`Redo line ${index + 1}`}
            className="touch-target flex h-8 items-center gap-1.5 rounded-full border border-line-strong bg-surface-3 px-3 text-micro font-semibold uppercase text-gold-300 transition-colors duration-fast hover:border-line-accent hover:bg-surface-4"
          >
            <Icon name="microphone" size={14} />
            Redo
          </button>
        </div>
      )}
      <div
        role="button"
        tabIndex={playable ? 0 : -1}
        aria-disabled={playable ? undefined : true}
        aria-current={isActive ? "true" : undefined}
        onKeyDown={handleKeyDown}
        className={`rounded-control font-serif text-body-lg leading-relaxed transition-colors duration-base sm:text-title-md sm:leading-relaxed ${
          isActive
            ? "text-ink-primary"
            : failed
              ? "text-ink-disabled line-through decoration-danger-400/60"
              : "text-ink-tertiary group-hover:text-ink-secondary"
        }`}
      >
        {seg.rawText}
      </div>
      {isPendingStatus(seg.status) && (
        <span className="mt-2 flex items-center gap-1.5 text-micro font-semibold uppercase text-gold-400">
          {seg.status === "processing" && <Spinner size={12} />}
          {seg.status === "processing" ? "Performing…" : "Queued"}
        </span>
      )}
      {failed && <span className="mt-2 block text-micro font-semibold uppercase text-danger-300">Couldn’t be voiced</span>}
    </li>
  );
});

interface SegmentTranscriptProps {
  segmentsList: Segment[];
  currentSegmentIndex: number;
  onSegmentSelect: (idx: number) => void;
  onSegmentRedo: (segId: string) => void;
}

export function SegmentTranscript({ segmentsList, currentSegmentIndex, onSegmentSelect, onSegmentRedo }: SegmentTranscriptProps) {
  const rowElementsRef = useRef(new Map<string, HTMLLIElement>());
  const lastManualScrollRef = useRef(0);
  const [detached, setDetached] = useState(false);

  const registerRowRef = useCallback((id: string, element: HTMLLIElement | null) => {
    if (element) rowElementsRef.current.set(id, element);
    else rowElementsRef.current.delete(id);
  }, []);

  const scrollToActive = useCallback(() => {
    const activeSegment = segmentsList[currentSegmentIndex];
    if (!activeSegment) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    rowElementsRef.current.get(activeSegment.id)?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
  }, [segmentsList, currentSegmentIndex]);

  useEffect(() => {
    if (Date.now() - lastManualScrollRef.current < MANUAL_SCROLL_GRACE_MS) {
      setDetached(true);
      return;
    }
    scrollToActive();
    setDetached(false);
    // Only a change of active line should move the transcript, not every segment-list refresh.
  }, [currentSegmentIndex]);

  const markManualScroll = () => {
    lastManualScrollRef.current = Date.now();
  };

  const returnToActive = () => {
    lastManualScrollRef.current = 0;
    setDetached(false);
    scrollToActive();
  };

  return (
    <div className="relative min-h-0 flex-1">
      <div
        className="transcript-fade scroll-quiet h-full overflow-y-auto overscroll-contain py-6"
        onWheel={markManualScroll}
        onTouchMove={markManualScroll}
        onKeyDown={(event) => {
          if (SCROLL_KEYS.has(event.key)) markManualScroll();
        }}
      >
        <ol role="list" aria-label="Transcript" className="mx-auto max-w-measure space-y-1.5">
          {segmentsList.map((seg, idx) => (
            <SegmentRow
              key={seg.id}
              seg={seg}
              index={idx}
              isActive={currentSegmentIndex === idx}
              onSelect={onSegmentSelect}
              onRedo={onSegmentRedo}
              registerRef={registerRowRef}
            />
          ))}
        </ol>
      </div>

      {detached && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <button
            type="button"
            onClick={returnToActive}
            className="chrome-glass pointer-events-auto flex h-9 items-center gap-1.5 rounded-full border border-line-strong px-4 text-caption font-semibold text-ink-primary shadow-e-2 animate-rise hover:border-line-control"
          >
            <Icon name="waveform" size={16} className="text-gold-300" />
            Back to the current line
          </button>
        </div>
      )}
    </div>
  );
}
