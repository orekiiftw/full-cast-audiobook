import { memo } from "react";
import { Icon } from "../ui/Icon";
import { isPendingStatus, isPlayableSegment } from "../../lib/segmentStatus";
import type { Segment } from "../../types/api";

interface SegmentRowProps {
  seg: Segment;
  index: number;
  isActive: boolean;
  onSelect: (idx: number) => void;
  onRedo: (segId: string) => void;
  registerRef: (id: string, el: HTMLDivElement | null) => void;
}

/**
 * Memoized so playback position ticks (~1/sec) don't re-render the whole
 * transcript — only rows whose own props changed (active line, fresh status).
 */
const SegmentRow = memo(function SegmentRow({
  seg,
  index,
  isActive,
  onSelect,
  onRedo,
  registerRef,
}: SegmentRowProps) {
  const playable = isPlayableSegment(seg);
  return (
    <div
      ref={(el) => registerRef(seg.id, el)}
      onClick={() => playable && onSelect(index)}
      className={`group relative rounded-xl p-4 transition-all duration-300 ${
        playable ? "cursor-pointer" : ""
      } ${
        isActive
          ? "bg-gold-500/[0.07] border border-gold-500/20 shadow-glow-soft"
          : "border border-transparent hover:bg-white/[0.02]"
      }`}
    >
      <p
        className={`font-serif text-[15px] sm:text-base leading-[1.75] transition-colors ${
          isActive ? "text-cinema-100" : "text-cinema-400"
        } ${seg.status === "failed" ? "opacity-40 line-through" : ""}`}
      >
        {seg.rawText}
      </p>
      {isPendingStatus(seg.status) && (
        <span className="mt-2.5 inline-block text-[10px] uppercase tracking-[0.14em] text-gold-400/80 font-medium">
          {seg.status === "processing" ? "Performing…" : "Queued"}
        </span>
      )}

      <div className="absolute right-3 top-3 opacity-0 group-hover:opacity-100 max-sm:opacity-100 transition-opacity">
        {playable && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRedo(seg.id);
            }}
            className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] font-medium bg-cinema-900/90 border border-white/[0.08] hover:border-gold-500/40 text-gold-400 px-2.5 py-1.5 rounded-lg transition-colors"
          >
            <Icon name="microphone" size={12} />
            Redo
          </button>
        )}
      </div>
    </div>
  );
});

interface SegmentTranscriptProps {
  segmentsList: Segment[];
  currentSegmentIndex: number;
  onSegmentSelect: (idx: number) => void;
  onSegmentRedo: (segId: string) => void;
  registerSegmentRef: (id: string, el: HTMLDivElement | null) => void;
}

export default function SegmentTranscript({
  segmentsList,
  currentSegmentIndex,
  onSegmentSelect,
  onSegmentRedo,
  registerSegmentRef,
}: SegmentTranscriptProps) {
  return (
    <div className="flex-1 overflow-y-auto mb-5 rounded-2xl border border-white/[0.05] bg-cinema-950/40 p-4 sm:p-6">
      <div className="max-w-2xl mx-auto space-y-3">
        {segmentsList.map((seg, idx) => (
          <SegmentRow
            key={seg.id}
            seg={seg}
            index={idx}
            isActive={currentSegmentIndex === idx}
            onSelect={onSegmentSelect}
            onRedo={onSegmentRedo}
            registerRef={registerSegmentRef}
          />
        ))}
      </div>
    </div>
  );
}
