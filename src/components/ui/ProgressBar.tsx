import { useCallback, useRef, useState } from "react";

interface ProgressBarProps {
  progress: number;
  buffered?: number;
  onSeek?: (ratio: number) => void;
  className?: string;
}

/**
 * Seekable progress track.
 * - Pointer Events (mouse + touch + pen) with pointer capture for drag scrubbing.
 * - The bar previews locally while dragging and only commits the seek on release,
 *   so scrubbing doesn't thrash audio loads across segment boundaries.
 * - The hit area is padded (py-2.5 => ~24px) so it's grabbable on touch screens
 *   while the visual track stays hairline-thin.
 */
export function ProgressBar({ progress, buffered = 0, onSeek, className = "" }: ProgressBarProps) {
  const safeProgress = Math.max(0, Math.min(100, progress));
  const safeBuffered = Math.max(0, Math.min(100, buffered));
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragRatio, setDragRatio] = useState<number | null>(null);

  const ratioFromClientX = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragRatio(ratioFromClientX(e.clientX));
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRatio === null) return;
    setDragRatio(ratioFromClientX(e.clientX));
  };

  const finishDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRatio === null || !onSeek) return;
    const ratio = ratioFromClientX(e.clientX);
    setDragRatio(null);
    onSeek(ratio);
  };

  const displayProgress = dragRatio !== null ? dragRatio * 100 : safeProgress;
  const interactive = !!onSeek;

  return (
    <div
      ref={trackRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      className={[
        "group relative w-full select-none py-2.5",
        interactive ? "cursor-pointer touch-none" : "",
        className,
      ].join(" ")}
      role="slider"
      aria-label="Seek"
      aria-valuenow={Math.round(displayProgress)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`relative w-full rounded-full bg-white/[0.06] transition-[height] duration-150 ${
          dragRatio !== null ? "h-2" : "h-1 group-hover:h-1.5"
        }`}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-white/10"
          style={{ width: `${safeBuffered}%` }}
        />
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-gold-500 to-gold-300 shadow-glow-sm"
          style={{ width: `${displayProgress}%` }}
        />
        {interactive && (
          <div
            className={`absolute top-1/2 h-3.5 w-3.5 rounded-full bg-white shadow-md ring-2 ring-gold-400/30 transition-opacity ${
              dragRatio !== null ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
            style={{ left: `${displayProgress}%`, transform: "translate(-50%, -50%)" }}
          />
        )}
      </div>
    </div>
  );
}
