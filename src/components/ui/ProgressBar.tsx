import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

const KEY_STEP_RATIO = 0.02;
const PAGE_STEP_RATIO = 0.1;

interface ProgressBarProps {
  progress: number;
  buffered?: number;
  onSeek?: (ratio: number) => void;
  className?: string;
  label?: string;
  valueText?: string;
  indeterminate?: boolean;
  tone?: "gold" | "studio" | "success" | "danger";
  thickness?: "hairline" | "regular";
  formatPreview?: (ratio: number) => string;
  onStep?: (direction: 1 | -1) => void;
}

const FILL_TONES = {
  gold: "bg-gold-400",
  studio: "bg-studio-400",
  success: "bg-success-400",
  danger: "bg-danger-400",
};

export function ProgressBar({
  progress,
  buffered = 0,
  onSeek,
  className = "",
  label = "Seek",
  valueText,
  indeterminate = false,
  tone = "gold",
  thickness = "regular",
  formatPreview,
  onStep,
}: ProgressBarProps) {
  const safeProgress = clampPercent(progress);
  const safeBuffered = clampPercent(buffered);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const interactive = !!onSeek;

  const ratioFromClientX = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, []);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragRatio(ratioFromClientX(event.clientX));
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRatio === null) return;
    setDragRatio(ratioFromClientX(event.clientX));
  };

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRatio === null || !onSeek) return;
    const ratio = ratioFromClientX(event.clientX);
    setDragRatio(null);
    onSeek(ratio);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    const current = safeProgress / 100;
    const direction =
      event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 0;
    let target: number | null = null;

    if (direction !== 0) {
      if (onStep) {
        event.preventDefault();
        event.stopPropagation();
        onStep(direction);
        return;
      }
      target = current + direction * KEY_STEP_RATIO;
    } else if (event.key === "PageUp") target = current + PAGE_STEP_RATIO;
    else if (event.key === "PageDown") target = current - PAGE_STEP_RATIO;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = 0.999;

    if (target === null) return;
    event.preventDefault();
    event.stopPropagation();
    onSeek(Math.max(0, Math.min(1, target)));
  };

  const displayProgress = dragRatio !== null ? dragRatio * 100 : safeProgress;
  const dragging = dragRatio !== null;
  const trackHeight = thickness === "hairline" ? "h-1" : "h-1.5";

  const track = (
    <div
      className={`relative w-full overflow-hidden rounded-full bg-ink-primary/10 ${trackHeight} ${
        interactive ? "origin-center transition-transform duration-fast ease-standard group-hover:scale-y-150" : ""
      } ${dragging ? "scale-y-150" : ""}`}
    >
      {indeterminate ? (
        <div className={`absolute inset-y-0 left-0 w-2/5 rounded-full animate-indeterminate ${FILL_TONES[tone]}`} />
      ) : (
        <>
          <div
            className="absolute inset-0 origin-left rounded-full bg-ink-primary/15"
            style={{ transform: `scaleX(${safeBuffered / 100})` }}
          />
          <div
            className={`absolute inset-0 origin-left rounded-full ${FILL_TONES[tone]}`}
            style={{ transform: `scaleX(${displayProgress / 100})` }}
          />
        </>
      )}
    </div>
  );

  if (!interactive) {
    return (
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={indeterminate ? undefined : 0}
        aria-valuemax={indeterminate ? undefined : 100}
        aria-valuenow={indeterminate ? undefined : Math.round(safeProgress)}
        aria-valuetext={valueText}
        className={`w-full ${className}`}
      >
        {track}
      </div>
    );
  }

  return (
    <div
      ref={trackRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(displayProgress)}
      aria-valuetext={valueText}
      className={`group relative flex h-6 w-full cursor-pointer touch-none select-none items-center rounded-full ${className}`}
    >
      {track}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-primary shadow-e-1 transition duration-fast ease-standard ${
          dragging
            ? "scale-100 opacity-100"
            : "scale-50 opacity-0 group-hover:scale-100 group-hover:opacity-100 group-focus-visible:scale-100 group-focus-visible:opacity-100"
        }`}
        style={{ left: `${displayProgress}%` }}
      />
      {dragging && formatPreview && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-full mb-2 -translate-x-1/2 rounded-control border border-line-strong bg-surface-3 px-2 py-1 font-mono text-caption tabular-nums text-ink-primary shadow-e-2"
          style={{ left: `clamp(2rem, ${displayProgress}%, calc(100% - 2rem))` }}
        >
          {formatPreview(displayProgress / 100)}
        </div>
      )}
    </div>
  );
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}
